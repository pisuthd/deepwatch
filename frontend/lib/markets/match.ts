/**
 * Cross-venue matcher. Given a DeepBook Predict oracle (oracleId +
 * expiryMs + an optional asset/question hint), find the nearest matching
 * Polymarket and Kalshi groups by expiry proximity.
 *
 * The match is purely on expiry (within `EXPIRY_TOLERANCE_MS`, default
 * 24 hours). Range markets could in principle be narrowed further by
 * strike midpoint proximity, but in practice the same day-of-expiry is
 * the strongest signal — Polymarket and Kalshi both anchor their ladders
 * to hourly settlements, while DeepBook Predict's oracles can be offset
 * by minutes from those settlement hours, so a 24h window catches
 * matches that a 1h window would miss.
 *
 * Sort order: a match is returned for whichever group is closest on
 * expiry. If multiple groups tie on expiry, the first one wins (Map
 * insertion order, which is upstream API order — fine for our needs).
 */

import type { PolymarketGroup } from "./polymarket";
import type { KalshiGroup } from "./kalshi";

export const EXPIRY_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export interface DbOracleRef {
  oracleId: string;
  expiryMs: number;
  question?: string;
}

export interface CrossVenueMatch {
  poly: PolymarketGroup | null;
  kalshi: KalshiGroup | null;
}

function closestByExpiry<T extends { expiryMs: number }>(
  groups: T[],
  targetMs: number,
  toleranceMs: number,
): T | null {
  let best: T | null = null;
  let bestDiff = Infinity;
  for (const g of groups) {
    const diff = Math.abs(g.expiryMs - targetMs);
    if (diff <= toleranceMs && diff < bestDiff) {
      best = g;
      bestDiff = diff;
    }
  }
  return best;
}

export function findMatchingGroups(
  dbOracle: DbOracleRef,
  polyGroups: PolymarketGroup[],
  kalshiGroups: KalshiGroup[],
  toleranceMs: number = EXPIRY_TOLERANCE_MS,
): CrossVenueMatch {
  return {
    poly: closestByExpiry(polyGroups, dbOracle.expiryMs, toleranceMs),
    kalshi: closestByExpiry(kalshiGroups, dbOracle.expiryMs, toleranceMs),
  };
}
