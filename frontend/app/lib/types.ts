/**
 * Shared types for the DeepWatch prediction-market search layer.
 *
 * Mirrors the root app's lib/markets/types.ts. Re-includes DEEPBOOK in
 * the Platform union because the global store fetches all three sources
 * (Polymarket + DeepBook Predict + Kalshi) in parallel.
 */

export type Platform = "POLYMARKET" | "KALSHI" | "DEEPBOOK";
export type Outcome = "YES" | "NO" | "UP" | "DOWN" | "OTHER";
export type Category = "CRYPTO" | "SPORTS" | "POLITICS" | "OTHER";
export type MarketType = "UP_DOWN" | "RANGE" | "OTHER";
export type OracleStatus = "ACTIVE" | "SETTLED" | "PENDING";

export interface BinaryMarket {
  id?: string;
  platform: "POLYMARKET" | "KALSHI";
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

export interface DeepBookMarket {
  id?: string;
  oracleId: string;
  expiryMs: number;
  strikeUsd: number;
  /**
   * Range-band bounds. Both null on up/down rows; both set on range rows
   * (one of three pre-picked bands: ±1%, ±3%, ±5% of spot). For range
   * rows `strikeUsd` is the band midpoint (a representative value so the
   * required strike column is always populated).
   */
  floorStrikeUsd: number | null;
  capStrikeUsd: number | null;
  /** 0 for up/down, 2 / 6 / 10 for the three range bands. */
  rangeBandPct: number;
  spotUsd: number | null;
  forwardUsd: number | null;
  impliedProbUp: number;
  sviA: number | null;
  sviB: number | null;
  sviRho: number | null;
  sviM: number | null;
  sviSigma: number | null;
  tickSizeUsd: number | null;
  minStrikeUsd: number | null;
  status: OracleStatus;
  rawJson: string;
  fetchedAt: string;
}