/**
 * Deterministic row-id helpers for the fetch-markets Lambda.
 *
 * The scheduled Lambda runs every 15 minutes; without deterministic IDs,
 * each run would create duplicate rows (create is insert-only). These
 * helpers produce stable, content-derived ids so the handler can
 * update-or-create and the BinaryMarket / DeepBookMarket tables stay
 * bounded over time.
 *
 *   BinaryMarket  : (platform, externalId, outcome) → id
 *   DeepBookMarket: (oracleId, expiryMs, strikeUsd, rangeBandPct) → id
 *
 * The id is the natural key, encoded as a single lowercase string so it
 * is stable across Lambda invocations, AppSync sort orders, and AWS
 * console searches. The format is the one we settled on in the plan.
 */

import type { BinaryMarket, DeepBookMarket, Outcome } from "./types";

/** Prefix scheme for the BinaryMarket id. Keeps the two platforms disjoint. */
type BinaryPlatform = BinaryMarket["platform"]; // "POLYMARKET" | "KALSHI"

function platformPrefix(p: BinaryPlatform): "pm" | "kx" {
  return p === "POLYMARKET" ? "pm" : "kx";
}

/**
 * Stable id for a single BinaryMarket row.
 *   binaryMarketId("POLYMARKET", "573652", "YES")
 *     → "pm-573652-yes"
 *   binaryMarketId("KALSHI", "KXBTC-26JUN1512-B66650", "NO")
 *     → "kx-kxbtc-26jun1512-b66650-no"
 *
 * Tickers are lowercased so the same logical market maps to the same id
 * regardless of casing in the upstream API.
 */
export function binaryMarketId(
  platform: BinaryPlatform,
  externalId: string,
  outcome: Outcome,
): string {
  return `${platformPrefix(platform)}-${externalId.toLowerCase()}-${outcome.toLowerCase()}`;
}

/**
 * Stable id for a single DeepBookMarket row.
 *   deepBookMarketId("0xcafe", 1718400000000, 70000, 0)
 *     → "db-0xcafe-1718400000000-70000-0"
 *
 * `rangeBandPct` is included so the five up/down strikes and the three
 * range bands from the same oracle share the oracle+expiry prefix but
 * each get their own row. encodeURIComponent is used on the oracle id
 * so the hex `0x...` form round-trips through AppSync's string column
 * without ambiguity.
 */
export function deepBookMarketId(
  oracleId: string,
  expiryMs: number,
  strikeUsd: number,
  rangeBandPct: number,
): string {
  // Round to 1e-6 to keep ids stable across runs even if the SVI model
  // returns a slightly different strike on a 0.0000001 boundary. Five
  // generated strikes per oracle won't be affected.
  const strikeRounded = Math.round(strikeUsd * 1e6) / 1e6;
  return `db-${encodeURIComponent(oracleId.toLowerCase())}-${expiryMs}-${strikeRounded}-${rangeBandPct}`;
}
