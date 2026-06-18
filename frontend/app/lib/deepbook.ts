/**
 * DeepBook Predict indexer fetcher + synthetic-ladder math.
 *
 * Pure functions; safe to import from the Next.js frontend. The shared
 * SVI math lives in `./svi` and the strike/band generators live in
 * `./format` — this file is the DeepBook-specific glue that pulls them
 * together.
 *
 * Two entry points:
 *
 *   - `fetchDeepBookMarkets(signal)` — fetch every active oracle from
 *     the indexer, generate a 5-strike ladder + 3 range bands per
 *     oracle, return one DeepBookMarket row per (oracle, strike/band).
 *     Powers the global store.
 *
 *   - `computeDeepBookLadder(market)` — given a single oracle's Market
 *     (from `app/hooks/useMarkets.ts`), project the SVI surface onto the
 *     same 5-strike + 3-band ladder used by the fetcher. Powers the
 *     LiveComparePanel and the AI insight prompt — same numbers in both
 *     places, by construction.
 *
 * Indexer: https://predict-server.testnet.mystenlabs.com
 * PREDICT_OBJECT_ID is the shared Sui object for the on-chain predict module.
 * All price fields from the indexer are scaled by PRICE_SCALE = 1e9.
 */

import type { DeepBookMarket, OracleStatus } from "./types";
import type { Market as DbMarket } from "../hooks/useMarkets";
import { DISPLAY_TICK_USD, generateRangeBands, generateStrikes } from "./format";
import { binaryUpProb, impliedProbUpForRange, impliedProbUpForStrike, sviVol, type SVIParams } from "./svi";
import { deepBookMarketId } from "./id";

export const DEEPBOOK_INDEXER = "https://predict-server.testnet.mystenlabs.com";
export const PREDICT_OBJECT_ID =
  "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";

const PRICE_SCALE = 1e9;

/**
 * Frontend view-time filter for near-certain markets. The grouping
 * function in this file drops any row whose impliedProbUp is outside
 * this band. 2%–98% mirrors polymarket.ts and kalshi.ts so the
 * "interesting markets" set is the same across sources.
 */
const MIN_IMPLIED_PROB = 0.02;
const MAX_IMPLIED_PROB = 0.98;

interface RawOracle {
  oracle_id: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: "active" | "settled" | "pending";
  underlying_asset?: string;
  settlement_price?: number;
  settled_at?: number;
}

interface RawOracleState {
  latest_price?: { spot: number; forward: number };
  latest_svi?: SVIParams;
}

async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const t = Date.now();
  const res = await fetch(url, { signal });
  if (!res.ok) {
    console.warn(`[deepbook] HTTP ${res.status} for ${url} in ${Date.now() - t}ms`);
    throw new Error(`DeepBook indexer HTTP ${res.status} for ${url}`);
  }
  const data = (await res.json()) as T;
  console.log(`[deepbook] HTTP ${res.status} for ${url} in ${Date.now() - t}ms`);
  return data;
}

function statusOf(s: RawOracle["status"]): OracleStatus {
  if (s === "active" || s === "settled" || s === "pending") return s.toUpperCase() as OracleStatus;
  return "PENDING";
}

function readSvi(raw: SVIParams | undefined): SVIParams | null {
  if (!raw) return null;
  return {
    a: Number(raw.a),
    b: Number(raw.b),
    rho: Number(raw.rho),
    m: Number(raw.m),
    sigma: Number(raw.sigma),
  };
}

/**
 * A group of DeepBook markets that share the same (oracle, expiry).
 * One oracle produces one group; the group has both a 5-strike UP_DOWN
 * ladder and a 3-band RANGE ladder, which together render as a single
 * (UpDownCard + RangeCard) side-by-side pair.
 */
export interface DeepBookGroup {
  oracleId: string;
  expiryMs: number;
  asset: string;
  spotUsd: number | null;
  forwardUsd: number | null;
  upDown: DeepBookMarket[];
  range: DeepBookMarket[];
}

/**
 * Group raw DeepBook rows into render-ready DeepBookGroup objects,
 * keyed by (oracleId, expiryMs). The latest non-null spot/forward
 * within a group is preserved on the group itself. Rows whose
 * impliedProbUp is outside the 2%–98% band are dropped — they are
 * either near-certain (collapsing) or stale (zero/one fallback).
 *
 * Sort order: earliest expiry first.
 */
export function groupDeepBookMarkets(rows: DeepBookMarket[]): DeepBookGroup[] {
  const map = new Map<string, DeepBookGroup>();
  for (const m of rows) {
    // Drop near-certain rows. DeepBook's SVI+Black-76 model can
    // collapse to 0/1 when the strike is far from spot, or when the
    // SVI sigma is near zero — those rows are not tradeable.
    if (m.impliedProbUp < MIN_IMPLIED_PROB || m.impliedProbUp > MAX_IMPLIED_PROB) continue;
    const k = `${m.oracleId}::${m.expiryMs}`;
    const entry: DeepBookGroup = map.get(k) ?? {
      oracleId: m.oracleId,
      expiryMs: m.expiryMs,
      asset: "BTC",
      spotUsd: m.spotUsd,
      forwardUsd: m.forwardUsd,
      upDown: [],
      range: [],
    };
    if (entry.spotUsd == null && m.spotUsd != null) entry.spotUsd = m.spotUsd;
    if (entry.forwardUsd == null && m.forwardUsd != null) entry.forwardUsd = m.forwardUsd;
    if (m.rangeBandPct === 0) entry.upDown.push(m);
    else entry.range.push(m);
    map.set(k, entry);
  }
  return Array.from(map.values()).sort((a, b) => a.expiryMs - b.expiryMs);
}

/**
 * Fetch every active oracle, generate a 5-strike ladder per oracle, compute
 * impliedProbUp from the SVI+Black-76 model, and return one DeepBookMarket
 * row per (oracle, strike). One oracle therefore produces 5 rows.
 */
export async function fetchDeepBookMarkets(
  signal?: AbortSignal,
): Promise<DeepBookMarket[]> {
  console.log(`[deepbook] GET /predicts/${PREDICT_OBJECT_ID.slice(0, 10)}…/oracles`);
  const oracles = await fetchJSON<RawOracle[]>(
    `${DEEPBOOK_INDEXER}/predicts/${PREDICT_OBJECT_ID}/oracles`,
    signal,
  );
  console.log(`[deepbook] received ${oracles.length} oracles`);

  const now = new Date().toISOString();
  const out: DeepBookMarket[] = [];
  let settledSkipped = 0;
  let expiredSkipped = 0;
  let stateFetchFails = 0;
  let processedOracles = 0;

  // 60-second buffer: filters out oracles that have already expired
  // (or are about to) even if the indexer hasn't flipped their status to
  // "settled" yet. Without this, the page shows markets whose probabilities
  // collapse to the fallback (svi.sigma / SVI_SCALE) because T = 0.
  const EXPIRY_BUFFER_MS = 60_000;
  const nowMs = Date.now();

  for (const oracle of oracles) {
    if (oracle.status === "settled") {
      settledSkipped += 1;
      continue;
    }
    // BTC only — the indexer also lists other assets (ETH, SUI, …) and we
    // don't want to ingest them. Skipped count is reported in the summary.
    if (oracle.underlying_asset && oracle.underlying_asset !== "BTC") {
      continue;
    }
    // Exclude oracles that have already expired (or are within the buffer).
    if (oracle.expiry <= nowMs + EXPIRY_BUFFER_MS) {
      expiredSkipped += 1;
      continue;
    }
    let state: RawOracleState = {};
    try {
      state = await fetchJSON<RawOracleState>(
        `${DEEPBOOK_INDEXER}/oracles/${oracle.oracle_id}/state`,
        signal,
      );
    } catch (e) {
      stateFetchFails += 1;
      console.warn(
        `[deepbook] failed to fetch state for oracle ${oracle.oracle_id.slice(0, 10)}… — skipping`,
        e instanceof Error ? e.message : String(e),
      );
      // Skip oracles whose state can't be fetched; don't abort the whole batch.
      continue;
    }
    processedOracles += 1;
    console.log(
      `[deepbook] oracle ${oracle.oracle_id.slice(0, 10)}… status=${oracle.status} ` +
      `expiry=${new Date(oracle.expiry).toISOString()} ` +
      `spot=${state.latest_price ? state.latest_price.spot / PRICE_SCALE : "n/a"} ` +
      `forward=${state.latest_price?.forward ?? "n/a"} ` +
      `svi=${state.latest_svi ? "yes" : "no"}`,
    );

    const spotUsd = state.latest_price ? state.latest_price.spot / PRICE_SCALE : 0;
    const forwardRaw = state.latest_price?.forward ?? 0;
    const tickSizeUsd = oracle.tick_size / PRICE_SCALE;
    const minStrikeUsd = oracle.min_strike / PRICE_SCALE;
    // Store raw on-chain SVI values (1e8 / 1e9 scale preserved) so the math is
    // reproducible from the DB. impliedProbUpForStrike handles scaling.
    const sviRaw = readSvi(state.latest_svi);
    const status = statusOf(oracle.status);

    // Generate a 5-strike ladder around the rounded spot. Falls back to min+5*tick
    // when spot is unknown (e.g. fresh oracle without price history).
    const baseSpot = spotUsd > 0 ? spotUsd : minStrikeUsd + 5 * tickSizeUsd;
    // Use the DISPLAY_TICK_USD ($1,000) for the strike ladder regardless of
    // the indexer's on-chain tick_size. The on-chain min_strike / tick_size
    // can be 1 USD on testnet, which makes the snap produce ugly values like
    // $61,541 instead of the $61,000 a user actually wants to see.
    const strikes = generateStrikes(baseSpot, 5, DISPLAY_TICK_USD);
    // Range ladder: three pre-picked bands (±1% / ±3% / ±5%) snapped to tick.
    // DeepBook Predict lets the user mint any (lower, higher) tuple, so we
    // surface a representative set in the search index.
    const bands = generateRangeBands(baseSpot, DISPLAY_TICK_USD);

    for (const strike of strikes) {
      const impliedProbUp = impliedProbUpForStrike(
        strike,
        forwardRaw,
        oracle.expiry,
        state.latest_svi ?? null,
      );

      out.push({
        id: deepBookMarketId(oracle.oracle_id, oracle.expiry, strike, 0),
        oracleId: oracle.oracle_id,
        expiryMs: oracle.expiry,
        strikeUsd: strike,
        floorStrikeUsd: null,
        capStrikeUsd: null,
        rangeBandPct: 0,
        spotUsd: spotUsd || null,
        forwardUsd: forwardRaw > 0 ? forwardRaw / PRICE_SCALE : null,
        impliedProbUp,
        sviA: sviRaw?.a ?? null,
        sviB: sviRaw?.b ?? null,
        sviRho: sviRaw?.rho ?? null,
        sviM: sviRaw?.m ?? null,
        sviSigma: sviRaw?.sigma ?? null,
        tickSizeUsd,
        minStrikeUsd,
        status,
        rawJson: JSON.stringify({ oracle, state }),
        fetchedAt: now,
      });
    }

    for (const band of bands) {
      const probRange = impliedProbUpForRange(
        band.floorUsd,
        band.capUsd,
        forwardRaw,
        oracle.expiry,
        state.latest_svi ?? null,
      );
      const bandMid = (band.floorUsd + band.capUsd) / 2;

      out.push({
        id: deepBookMarketId(oracle.oracle_id, oracle.expiry, bandMid, band.widthPct),
        oracleId: oracle.oracle_id,
        expiryMs: oracle.expiry,
        // Midpoint so the required strikeUsd column is always populated;
        // the actual range bounds live in floorStrikeUsd / capStrikeUsd.
        strikeUsd: bandMid,
        floorStrikeUsd: band.floorUsd,
        capStrikeUsd: band.capUsd,
        rangeBandPct: band.widthPct,
        spotUsd: spotUsd || null,
        forwardUsd: forwardRaw > 0 ? forwardRaw / PRICE_SCALE : null,
        impliedProbUp: probRange,
        sviA: sviRaw?.a ?? null,
        sviB: sviRaw?.b ?? null,
        sviRho: sviRaw?.rho ?? null,
        sviM: sviRaw?.m ?? null,
        sviSigma: sviRaw?.sigma ?? null,
        tickSizeUsd,
        minStrikeUsd,
        status,
        rawJson: JSON.stringify({ oracle, state }),
        fetchedAt: now,
      });
    }
  }

  console.log(
    `[deepbook] summary: ${oracles.length} oracles, ${settledSkipped} settled-skipped, ` +
    `${expiredSkipped} expired-skipped, ${stateFetchFails} state-fetch-failed, ` +
    `${processedOracles} processed, ${out.length} rows written (5 up/down + 3 range per oracle)`,
  );
  if (out.length > 0) {
    const upDownRow = out.find((r) => r.rangeBandPct === 0);
    const rangeRow = out.find((r) => r.rangeBandPct > 0);
    if (upDownRow) {
      console.log(`[deepbook] up/down sample:`, JSON.stringify({
        oracleId: upDownRow.oracleId.slice(0, 10) + "…",
        strikeUsd: upDownRow.strikeUsd,
        impliedProbUp: upDownRow.impliedProbUp,
        spotUsd: upDownRow.spotUsd,
      }));
    }
    if (rangeRow) {
      console.log(`[deepbook] range sample:`, JSON.stringify({
        oracleId: rangeRow.oracleId.slice(0, 10) + "…",
        floorStrikeUsd: rangeRow.floorStrikeUsd,
        capStrikeUsd: rangeRow.capStrikeUsd,
        rangeBandPct: rangeRow.rangeBandPct,
        impliedProbUp: rangeRow.impliedProbUp,
      }));
    }
  }

  return out;
}

// ─── computeDeepBookLadder (LiveComparePanel / AI prompt) ───────────────────

/** Same row shape as Polymarket/Kalshi ladders, so the AI prompt aligns 1:1. */
export interface DeepBookUpDownRow {
  strikeUsd: number;
  impliedProbUp: number;
  description: string | null;
  priceToBeatUsd: number | null;
}

export interface DeepBookRangeRow {
  floorStrikeUsd: number;
  capStrikeUsd: number;
  rangeBandPct: number;
  impliedProbUp: number;
  description: string | null;
}

export interface DeepBookLadder {
  /** Scaled to USD (÷ PRICE_SCALE) for parity with the JSON payload. */
  spotUsd: number;
  forwardUsd: number;
  upDown: DeepBookUpDownRow[];
  range: DeepBookRangeRow[];
}

const TICK = 1000;
const N_STRIKES = 5;

/**
 * Project the SVI surface onto a finite ladder for a given DeepBook
 * market. Returns `null` if the market has no SVI / forward data, or if
 * the oracle has already expired (T ≤ 0).
 */
export function computeDeepBookLadder(market: DbMarket): DeepBookLadder | null {
  if (!market.svi || !market.forward || market.forward <= 0) return null;
  const F = market.forward / PRICE_SCALE;
  const spot = (market.spot || 0) / PRICE_SCALE;
  const T = Math.max(
    0,
    (market.expiryMs - Date.now()) / (365.25 * 24 * 3600 * 1000),
  );
  if (T <= 0) return null;

  const strikes = generateStrikes(spot, N_STRIKES, TICK);
  const upDown: DeepBookUpDownRow[] = strikes.map((strikeUsd) => ({
    strikeUsd,
    impliedProbUp: binaryUpProb(F, strikeUsd, T, sviVol(strikeUsd, F, T, market.svi!)),
    description: null,
    priceToBeatUsd: null,
  }));

  const bands = generateRangeBands(spot, TICK);
  const range: DeepBookRangeRow[] = bands.map((b) => {
    const volFloor = sviVol(b.floorUsd, F, T, market.svi!);
    const volCap = sviVol(b.capUsd, F, T, market.svi!);
    const inProb = Math.max(
      0,
      binaryUpProb(F, b.floorUsd, T, volFloor) -
        binaryUpProb(F, b.capUsd, T, volCap),
    );
    return {
      floorStrikeUsd: b.floorUsd,
      capStrikeUsd: b.capUsd,
      rangeBandPct: b.widthPct,
      impliedProbUp: inProb,
      description: null,
    };
  });

  return { spotUsd: spot, forwardUsd: F, upDown, range };
}