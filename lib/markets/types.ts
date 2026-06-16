/**
 * Shared types for the DeepWatch prediction-market search layer.
 *
 * The same shapes are used by the scheduled fetch-markets Lambda (writes)
 * and the /search page (reads via AppSync). Keep them in lockstep with
 * amplify/data/resource.ts.
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
  impliedProb: number;          // 0–1
  bestBidUsd: number | null;
  bestAskUsd: number | null;
  volume24hUsd: number | null;
  /**
   * Up/down markets: the single strike price (e.g. "Will Bitcoin hit $150k?"
   * → 150000). For Polymarket multi-strike ladders, parsed from
   * `groupItemTitle` (e.g. "↑ 200,000" → 200000). Null for date-ladders
   * and intraday "Bitcoin Up or Down" events.
   * Range markets: the band midpoint ((floor + cap) / 2) so the column
   * is always populated for sort/display.
   */
  strikeUsd: number | null;
  /**
   * Range-band bounds. Both null on up/down rows; both set on range rows.
   * For Polymarket, parsed from `groupItemTitle` when the title is
   * shaped like "low-high" (e.g. "54,000-56,000" → 54000, 56000).
   * Mirrors `DeepBookMarket` for cross-platform range analytics.
   */
  floorStrikeUsd: number | null;
  capStrikeUsd: number | null;
  /**
   * Polymarket "Up or Down" intraday markets: the BTC open price of
   * the 1-hour candle at the event's start time (i.e. the "Price To
   * Beat" shown on Polymarket's site). Fetched once per Lambda run
   * from Binance's klines API. Null for non-Up-or-Down markets and
   * for any Up-or-Down market whose price couldn't be fetched.
   */
  priceToBeatUsd: number | null;
  expiryMs: number | null;
  marketType: MarketType;
  url: string;
  rawJson: string;
  fetchedAt: string;            // ISO
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
  impliedProbUp: number;        // 0–1
  sviA: number | null;
  sviB: number | null;
  sviRho: number | null;
  sviM: number | null;
  sviSigma: number | null;
  tickSizeUsd: number | null;
  minStrikeUsd: number | null;
  status: OracleStatus;
  rawJson: string;
  fetchedAt: string;            // ISO
}

/** Filter shape used by the /search page and stored in URL params. */
export interface SearchFilters {
  expiryFrom: string | null;    // ISO date
  expiryTo: string | null;      // ISO date
  marketType: MarketType | "ALL";
  category: Category | "ALL";
  subcategory: string | null;   // "Bitcoin", "Ethereum", "All", …
  sources: Platform[];          // which platforms to display
}
