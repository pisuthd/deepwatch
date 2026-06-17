/**
 * Deterministic row-id helpers for the Polymarket / Kalshi fetchers.
 *
 * Mirrors the root app's lib/markets/id.ts, dropped down to just the
 * `binaryMarketId` helper — `deepBookMarketId` is unused here because
 * DeepBook Predict lives in `/frontend/app/hooks/useMarkets.ts` and
 * doesn't need a global id.
 *
 *   binaryMarketId("POLYMARKET", "573652", "YES")
 *     → "pm-573652-yes"
 *   binaryMarketId("KALSHI", "KXBTC-26JUN1512-B66650", "NO")
 *     → "kx-kxbtc-26jun1512-b66650-no"
 */

import type { BinaryMarket, Outcome } from "./types";

type BinaryPlatform = BinaryMarket["platform"];

function platformPrefix(p: BinaryPlatform): "pm" | "kx" {
  return p === "POLYMARKET" ? "pm" : "kx";
}

export function binaryMarketId(
  platform: BinaryPlatform,
  externalId: string,
  outcome: Outcome,
): string {
  return `${platformPrefix(platform)}-${externalId.toLowerCase()}-${outcome.toLowerCase()}`;
}
