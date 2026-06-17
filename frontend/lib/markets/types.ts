/**
 * Shared types for the DeepWatch prediction-market search layer.
 *
 * Mirrors the root app's lib/markets/types.ts but with `DEEPBOOK` removed
 * from the `Platform` union — DeepBook Predict lives in `/frontend`'s
 * `app/hooks/useMarkets.ts`, so the global Polymarket + Kalshi store only
 * needs to express the two binary platforms.
 */

export type Platform = "POLYMARKET" | "KALSHI";
export type Outcome = "YES" | "NO" | "UP" | "DOWN" | "OTHER";
export type Category = "CRYPTO" | "SPORTS" | "POLITICS" | "OTHER";
export type MarketType = "UP_DOWN" | "RANGE" | "OTHER";

export interface BinaryMarket {
  id?: string;
  platform: Platform;
  externalId: string;
  externalEventId: string | null;
  question: string;
  description: string | null;
  category: Category;
  subcategory: string | null;
  outcome: Outcome;
  /** 0–1 */
  impliedProb: number;
  bestBidUsd: number | null;
  bestAskUsd: number | null;
  volume24hUsd: number | null;
  /**
   * Up/down markets: the single strike price. Range markets: the band
   * midpoint ((floor + cap) / 2). Null for date-ladders and intraday
   * "Bitcoin Up or Down" events that don't carry a strike.
   */
  strikeUsd: number | null;
  /** Both null on up/down rows; both set on range rows. */
  floorStrikeUsd: number | null;
  capStrikeUsd: number | null;
  /**
   * Polymarket "Up or Down" intraday markets only — the BTC open price
   * of the 1-hour candle at the event's start time. Null elsewhere.
   */
  priceToBeatUsd: number | null;
  expiryMs: number | null;
  marketType: MarketType;
  url: string;
  rawJson?: string;
  fetchedAt?: string;
}
