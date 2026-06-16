import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { env } from "$amplify/env/fetchMarkets";

import type { Schema } from "../../data/resource";
import type { BinaryMarket, DeepBookMarket } from "../../../lib/markets/types";
import { fetchDeepBookMarkets } from "../../../lib/markets/deepbook";
import { fetchPolymarketMarkets } from "../../../lib/markets/polymarket";
import { fetchKalshiMarkets } from "../../../lib/markets/kalshi";

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);

Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();


const log = (...args: unknown[]) => console.log("[fetch-markets]", ...args);
const warn = (...args: unknown[]) => console.warn("[fetch-markets]", ...args);
const err = (...args: unknown[]) => console.error("[fetch-markets]", ...args);

// ── Write-side policy ───────────────────────────────────────────────────────
//
// Production schedule is every 15 minutes → 96 runs/day. Without these knobs
// the BinaryMarket / DeepBookMarket tables grow unbounded (mostly duplicates).
// The full plan lives at the end of the Phase-1 plan file; the implementation
// is split across these helpers:

/** Drop markets expiring within this window — the next run will skip them via
 *  the upstream `active=false` flag anyway, so writing them now is noise. */
const NEAR_EXPIRY_MS = 60 * 60 * 1000;        // 1 hour
/** Drop markets expiring beyond this window — long-dated noise. */
const FAR_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;  // 365 days

type DropCounts = {
  /** No trading signal: zero volume AND no best bid AND no best ask. */
  dead: number;
  /** impliedProb is 0 or 1 — resolved or untradeable. */
  degenerate: number;
  /** Expiry within NEAR_EXPIRY_MS. */
  nearExpiry: number;
  /** Expiry beyond FAR_EXPIRY_MS. */
  farExpiry: number;
};

type PlatformStat = {
  written: number;
  failed: number;
  error: string | null;
  fetched: number;
  dropped: DropCounts;
};

type RunSummary = {
  trigger: "schedule" | "manual";
  durationMs: number;
  polymarket: PlatformStat;
  kalshi: PlatformStat;
  deepbook: PlatformStat;
};

function summariseError(e: unknown): { name: string; message: string; stack?: string } {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { name: "Unknown", message: String(e) };
}

/** Recognise the data-client "row not found" error so we can fall back to create. */
function isNotFoundError(e: unknown): boolean {
  if (e == null) return false;
  const msg = e instanceof Error ? e.message : String(e);
  return /not\s*found/i.test(msg) || /does not exist/i.test(msg) || /\b404\b/.test(msg);
}

/** Filter BinaryMarket rows (Polymarket + Kalshi) before the upsert. */
function applyBinaryFilters(rows: BinaryMarket[], nowMs: number): { kept: BinaryMarket[]; dropped: DropCounts } {
  const dropped: DropCounts = { dead: 0, degenerate: 0, nearExpiry: 0, farExpiry: 0 };
  const kept: BinaryMarket[] = [];
  for (const row of rows) {
    const hasVolume = row.volume24hUsd != null && row.volume24hUsd > 0;
    const hasQuote = row.bestBidUsd != null || row.bestAskUsd != null;
    if (!hasVolume && !hasQuote) {
      dropped.dead += 1;
      continue;
    }
    if (row.impliedProb === 0 || row.impliedProb === 1) {
      dropped.degenerate += 1;
      continue;
    }
    if (row.expiryMs != null) {
      const delta = row.expiryMs - nowMs;
      if (delta < NEAR_EXPIRY_MS) {
        dropped.nearExpiry += 1;
        continue;
      }
      if (delta > FAR_EXPIRY_MS) {
        dropped.farExpiry += 1;
        continue;
      }
    }
    kept.push(row);
  }
  return { kept, dropped };
}

/** Filter DeepBookMarket rows: just enforce status === ACTIVE. */
function applyDeepBookFilters(rows: DeepBookMarket[]): { kept: DeepBookMarket[]; dropped: DropCounts } {
  const dropped: DropCounts = { dead: 0, degenerate: 0, nearExpiry: 0, farExpiry: 0 };
  const kept: DeepBookMarket[] = [];
  for (const row of rows) {
    if (row.status !== "ACTIVE") {
      dropped.dead += 1;
      continue;
    }
    kept.push(row);
  }
  return { kept, dropped };
}

/** Structural type for the data-client model wrapper. Satisfied by both
 *  `client.models.BinaryMarket` and `client.models.DeepBookMarket`. The
 *  return type is `unknown` because the v6 client shape varies: the typed
 *  surface says `data: T` (no null), but at runtime AppSync returns
 *  `{ data: { updateX: null }, errors: [...] }` on NotFound. The TS type
 *  system lies — see the comment on `upsertOne` for the full story. */
type DataModel = {
  update: (input: unknown) => Promise<unknown>;
  create: (input: unknown) => Promise<unknown>;
};

/** Shape of a data-client response. `data` may be null on failed mutations
 *  (NotFound / ConditionalCheckFailed) even when the TS type says otherwise.
 *  `errors` is set on the top-level GraphQL response when AppSync returns
 *  error objects — the v6 client may or may not throw on these. */
type DataClientResponse = {
  data?: unknown;
  errors?: Array<{ errorType?: string; message?: string }>;
};

/** Returns true when the response represents a successful write. A response
 *  is "ok" if it has a non-null `data` field AND no errors. This catches both
 *  the throwing case (the client throws before we even get here) and the
 *  silent-failure case (data is null on NotFound, no exception thrown). */
function isResponseOk(res: unknown): boolean {
  if (res == null) return false;
  const r = res as DataClientResponse;
  if (Array.isArray(r.errors) && r.errors.length > 0) return false;
  if (r.data == null) return false;
  // data: { updateX: <row> | null } or { createX: <row> | null }
  if (typeof r.data === "object") {
    const inner = r.data as Record<string, unknown>;
    for (const key of Object.keys(inner)) {
      if (inner[key] == null) return false;
    }
  }
  return true;
}

/** First error message in a response, if any. */
function firstErrorMessage(res: unknown): string | null {
  if (res == null) return null;
  const r = res as DataClientResponse;
  if (Array.isArray(r.errors) && r.errors.length > 0) {
    return r.errors[0]?.message ?? "unknown GraphQL error";
  }
  return null;
}

/** Update-or-create one row.
 *
 *  The first Lambda runs we observed (15m schedule, ~1038 rows/run) reported
 *  100% success but the AppSync table stayed empty. Root cause: the v6 data
 *  client surfaces NotFound / ConditionalCheckFailed as `{ data: { updateX:
 *  null } }` rather than throwing — so a `try { update }` block silently
 *  passed through to `stat.written += 1` with no actual write happening.
 *
 *  The defensive check uses `isResponseOk` on both the update and the create
 *  response: any non-null `errors` array OR any null inner value is treated
 *  as failure and triggers the create-fallback (or a hard fail). */
async function upsertOne(
  model: DataModel,
  row: unknown,
  stat: PlatformStat,
): Promise<void> {
  // 1) Try update.
  let updateRes: unknown;
  try {
    updateRes = await model.update(row);
  } catch (e) {
    // The v6 client DOES throw on some errors (network, auth). Treat all
    // thrown errors as "update failed" and fall through to create.
    if (!isNotFoundError(e) && !stat.error) {
      stat.error = summariseError(e).message;
    }
    updateRes = null;
  }
  if (isResponseOk(updateRes)) {
    stat.written += 1;
    return;
  }

  // 2) Update failed (NotFound or null data). Try create.
  let createRes: unknown;
  try {
    createRes = await model.create(row);
  } catch (e) {
    stat.failed += 1;
    if (!stat.error) stat.error = summariseError(e).message;
    return;
  }
  if (isResponseOk(createRes)) {
    stat.written += 1;
    return;
  }

  // 3) Both failed.
  stat.failed += 1;
  if (!stat.error) {
    const msg = firstErrorMessage(createRes) ?? firstErrorMessage(updateRes);
    if (msg) stat.error = msg;
  }
}

/** Chunked update-or-create. chunkSize=50 — well under the AppSync 1MB
 *  request body cap and ~2x fewer round trips than the previous 25. */
async function upsertBatch(
  label: string,
  rows: Array<{ id?: string }>,
  model: DataModel,
  stat: PlatformStat,
): Promise<void> {
  stat.fetched = rows.length;
  if (rows.length === 0) {
    log(`[${label}] nothing to write`);
    return;
  }
  const chunkSize = 50;
  log(`[${label}] upserting ${rows.length} rows in chunks of ${chunkSize}…`);
  const writeStart = Date.now();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const chunkStart = Date.now();
    const writtenBefore = stat.written;
    const failedBefore = stat.failed;
    // Per-row upserts run in parallel; each upsert internally serialises
    // update → (maybe) create.
    await Promise.allSettled(chunk.map((row) => upsertOne(model, row, stat)));
    const chunkWritten = stat.written - writtenBefore;
    const chunkFailed = stat.failed - failedBefore;
    log(
      `[${label}] chunk ${i / chunkSize + 1}/${Math.ceil(rows.length / chunkSize)}: ` +
      `${chunkWritten} ok / ${chunkFailed} fail in ${Date.now() - chunkStart}ms`,
    );
    if (chunkFailed > 0) {
      warn(`[${label}] chunk had ${chunkFailed} failures; first error:`, stat.error);
    }
  }
  log(
    `[${label}] done in ${Date.now() - writeStart}ms: ` +
    `${stat.written} written, ${stat.failed} failed`,
  );
}

/**
 * Two invocation paths:
 *  - EventBridge schedule: `event` is a ScheduledEvent (no `arguments` key).
 *  - AppSync via fetchMarkets query: `event` carries `arguments`, etc.
 * The `arguments` shape is whatever we declared in amplify/data/resource.ts
 * (currently `{}`), so we can ignore it — this function does one job: pull
 * the latest snapshots and upsert them into the data tables.
 */
export const handler: Schema["fetchMarkets"]["functionHandler"] = async (event) => {
  const trigger: RunSummary["trigger"] = event && (event as { arguments?: unknown }).arguments !== undefined
    ? "manual"
    : "schedule";

  const t0 = Date.now();
  log("=== handler start ===", { trigger });

  // ── Fetch phase ──────────────────────────────────────────────────────────
  log("starting 3 platform fetches in parallel…");
  const fetchStart = Date.now();
  const [polyResult, kalshiResult, deepbookResult] = await Promise.allSettled([
    (async () => {
      const t = Date.now();
      log("→ polymarket fetch start");
      const rows = await fetchPolymarketMarkets();
      log("← polymarket fetch done", { rows: rows.length, ms: Date.now() - t });
      return rows;
    })(),
    (async () => {
      const t = Date.now();
      log("→ kalshi fetch start");
      const rows = await fetchKalshiMarkets();
      log("← kalshi fetch done", { rows: rows.length, ms: Date.now() - t });
      return rows;
    })(),
    (async () => {
      const t = Date.now();
      log("→ deepbook fetch start");
      const rows = await fetchDeepBookMarkets();
      log("← deepbook fetch done", { rows: rows.length, ms: Date.now() - t });
      return rows;
    })(),
  ]);
  log("all 3 fetches settled in", Date.now() - fetchStart, "ms");

  if (polyResult.status === "rejected") {
    err("polymarket fetch REJECTED:", summariseError(polyResult.reason));
  }
  if (kalshiResult.status === "rejected") {
    err("kalshi fetch REJECTED:", summariseError(kalshiResult.reason));
  }
  if (deepbookResult.status === "rejected") {
    err("deepbook fetch REJECTED:", summariseError(deepbookResult.reason));
  }

  const emptyDropCounts = (): DropCounts => ({ dead: 0, degenerate: 0, nearExpiry: 0, farExpiry: 0 });
  const stats = {
    polymarket: { written: 0, failed: 0, error: null as string | null, fetched: 0, dropped: emptyDropCounts() } satisfies PlatformStat,
    kalshi: { written: 0, failed: 0, error: null as string | null, fetched: 0, dropped: emptyDropCounts() } satisfies PlatformStat,
    deepbook: { written: 0, failed: 0, error: null as string | null, fetched: 0, dropped: emptyDropCounts() } satisfies PlatformStat,
  };

  const now = Date.now();

  // ── Write phase ──────────────────────────────────────────────────────────
  if (polyResult.status === "fulfilled") {
    const { kept, dropped } = applyBinaryFilters(polyResult.value as BinaryMarket[], now);
    stats.polymarket.dropped = dropped;
    log(
      `[polymarket] filtered: kept=${kept.length} ` +
      `dropped=${JSON.stringify(dropped)}`,
    );
    await upsertBatch(
      "polymarket",
      kept as Array<{ id?: string }>,
      client!.models.BinaryMarket as unknown as DataModel,
      stats.polymarket,
    );
  } else {
    stats.polymarket.error = summariseError(polyResult.reason).message;
  }

  if (kalshiResult.status === "fulfilled") {
    const { kept, dropped } = applyBinaryFilters(kalshiResult.value as BinaryMarket[], now);
    stats.kalshi.dropped = dropped;
    log(
      `[kalshi] filtered: kept=${kept.length} ` +
      `dropped=${JSON.stringify(dropped)}`,
    );
    await upsertBatch(
      "kalshi",
      kept as Array<{ id?: string }>,
      client!.models.BinaryMarket as unknown as DataModel,
      stats.kalshi,
    );
  } else {
    stats.kalshi.error = summariseError(kalshiResult.reason).message;
  }

  if (deepbookResult.status === "fulfilled") {
    const { kept, dropped } = applyDeepBookFilters(deepbookResult.value as DeepBookMarket[]);
    stats.deepbook.dropped = dropped;
    log(
      `[deepbook] filtered: kept=${kept.length} ` +
      `dropped=${JSON.stringify(dropped)}`,
    );
    await upsertBatch(
      "deepbook",
      kept as Array<{ id?: string }>,
      client!.models.DeepBookMarket as unknown as DataModel,
      stats.deepbook,
    );
  } else {
    stats.deepbook.error = summariseError(deepbookResult.reason).message;
  }

  const summary: RunSummary = {
    trigger,
    durationMs: Date.now() - t0,
    polymarket: { ...stats.polymarket },
    kalshi: { ...stats.kalshi },
    deepbook: { ...stats.deepbook },
  };
  log("=== handler complete ===", JSON.stringify(summary, null, 2));
  return summary;
};
