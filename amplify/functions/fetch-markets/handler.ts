import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { env } from "$amplify/env/fetch-markets";

import type { Schema } from "../../data/resource";
import { fetchDeepBookMarkets } from "../../../lib/markets/deepbook";
import { fetchPolymarketMarkets } from "../../../lib/markets/polymarket";
import { fetchKalshiMarkets } from "../../../lib/markets/kalshi";

const log = (...args: unknown[]) => console.log("[fetch-markets]", ...args);
const warn = (...args: unknown[]) => console.warn("[fetch-markets]", ...args);
const err = (...args: unknown[]) => console.error("[fetch-markets]", ...args);

function summariseError(e: unknown): { name: string; message: string; stack?: string } {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  return { name: "Unknown", message: String(e) };
}

type PlatformStat = {
  written: number;
  failed: number;
  error: string | null;
  fetched: number;
};

type RunSummary = {
  trigger: "schedule" | "manual";
  durationMs: number;
  polymarket: PlatformStat;
  kalshi: PlatformStat;
  deepbook: PlatformStat;
};

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

  let client: ReturnType<typeof generateClient<Schema>>;
  try {
    const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
    log("getAmplifyDataClientConfig ok in", Date.now() - t0, "ms");
    Amplify.configure(resourceConfig, libraryOptions);
    client = generateClient<Schema>();
    log("Amplify + client ready");
  } catch (e) {
    err("FATAL: failed to initialise Amplify data client", summariseError(e));
    throw e;
  }

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

  const stats = {
    polymarket: { written: 0, failed: 0, error: null as string | null, fetched: 0 } satisfies PlatformStat,
    kalshi: { written: 0, failed: 0, error: null as string | null, fetched: 0 } satisfies PlatformStat,
    deepbook: { written: 0, failed: 0, error: null as string | null, fetched: 0 } satisfies PlatformStat,
  };

  // Helper: write a batch to the named model. We chunk to avoid oversized
  // single mutations. The data client creates new rows per snapshot.
  async function writeBatch<T extends Record<string, unknown>>(
    label: string,
    rows: T[],
    create: (row: T) => Promise<unknown>,
    stat: PlatformStat,
  ) {
    stat.fetched = rows.length;
    if (rows.length === 0) {
      log(`[${label}] nothing to write`);
      return;
    }
    log(`[${label}] writing ${rows.length} rows in chunks of 25…`);
    const chunkSize = 25;
    const writeStart = Date.now();
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const chunkStart = Date.now();
      const results = await Promise.allSettled(chunk.map(create));
      let chunkWritten = 0;
      let chunkFailed = 0;
      for (const r of results) {
        if (r.status === "fulfilled") {
          stat.written += 1;
          chunkWritten += 1;
        } else {
          stat.failed += 1;
          chunkFailed += 1;
          if (!stat.error) {
            stat.error = summariseError(r.reason).message;
          }
        }
      }
      log(`[${label}] chunk ${i / chunkSize + 1}/${Math.ceil(rows.length / chunkSize)}: ${chunkWritten} ok / ${chunkFailed} fail in ${Date.now() - chunkStart}ms`);
      if (chunkFailed > 0) {
        warn(`[${label}] chunk had ${chunkFailed} failures; first error:`, stat.error);
      }
    }
    log(`[${label}] done in ${Date.now() - writeStart}ms: ${stat.written} written, ${stat.failed} failed`);
  }

  // ── Write phase ──────────────────────────────────────────────────────────
  if (polyResult.status === "fulfilled") {
    await writeBatch(
      "polymarket",
      polyResult.value as unknown as Array<Record<string, unknown>>,
      (row) => client!.models.BinaryMarket.create(row as never),
      stats.polymarket,
    );
  } else {
    stats.polymarket.error = summariseError(polyResult.reason).message;
  }

  if (kalshiResult.status === "fulfilled") {
    await writeBatch(
      "kalshi",
      kalshiResult.value as unknown as Array<Record<string, unknown>>,
      (row) => client!.models.BinaryMarket.create(row as never),
      stats.kalshi,
    );
  } else {
    stats.kalshi.error = summariseError(kalshiResult.reason).message;
  }

  if (deepbookResult.status === "fulfilled") {
    await writeBatch(
      "deepbook",
      deepbookResult.value as unknown as Array<Record<string, unknown>>,
      (row) => client!.models.DeepBookMarket.create(row as never),
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
