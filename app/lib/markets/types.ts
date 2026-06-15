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
  strikeUsd: number | null;
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
