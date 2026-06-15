/**
 * DeepBook Predict indexer fetcher. Pure functions; safe to import from
 * the scheduled Lambda handler and from the Next.js frontend.
 *
 * Indexer: https://predict-server.testnet.mystenlabs.com
 * PREDICT_OBJECT_ID is the shared Sui object for the on-chain predict module.
 * All price fields from the indexer are scaled by PRICE_SCALE = 1e9.
 */

import type { DeepBookMarket, OracleStatus } from "./types";
import { DISPLAY_TICK_USD, generateRangeBands, generateStrikes } from "./format";
import { impliedProbUpForRange, impliedProbUpForStrike, type SVIParams } from "./svi";
import { deepBookMarketId } from "./id";

export const DEEPBOOK_INDEXER = "https://predict-server.testnet.mystenlabs.com";
export const PREDICT_OBJECT_ID =
  "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";

const PRICE_SCALE = 1e9;

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
  let stateFetchFails = 0;
  let processedOracles = 0;

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
    const strikes = generateStrikes(baseSpot, 5, tickSizeUsd || 1000);
    // Range ladder: three pre-picked bands (±1% / ±3% / ±5%) snapped to tick.
    // DeepBook Predict lets the user mint any (lower, higher) tuple, so we
    // surface a representative set in the search index.
    const bands = generateRangeBands(baseSpot, tickSizeUsd || DISPLAY_TICK_USD);

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
    `${stateFetchFails} state-fetch-failed, ${processedOracles} processed, ` +
    `${out.length} rows written (5 up/down + 3 range per oracle)`,
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
