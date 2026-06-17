/**
 * Insight metadata + payload shape — the local-first version.
 *
 * The blob shape (`InsightBody`) is data-driven: the user picks a
 * DeepBook Predict market, the wizard auto-finds matching Polymarket
 * + Kalshi groups (by expiry), then the AI generates a structured
 * comparison summary. The raw data backing that summary lives in
 * `includes.live` so consumers can re-render or analyze programmatically
 * without re-fetching.
 *
 * Insights are stored locally in `localStorage` via
 * `app/stores/insights-store.tsx` (key: `deepwatch:insights:v1`). There
 * is no Walrus upload — that whole surface was removed. The list page
 * reads from the local store, and the detail panel renders `InsightBody`
 * directly with no blob fetch.
 */

import type { PolymarketGroup } from '@/lib/markets/polymarket';
import type { KalshiGroup } from '@/lib/markets/kalshi';

export type InsightAsset = 'BTC' | 'SUI' | 'WAL';
export const INSIGHT_ASSETS: readonly InsightAsset[] = ['BTC', 'SUI', 'WAL'] as const;

export const INSIGHT_MAX_BYTES = 100 * 1024;

// ─── Body types ─────────────────────────────────────────────────────────────

/**
 * Raw SVI parameters at the moment the insight was published. Stored
 * unscaled — `a/b/m/sigma` are × 1e8 and `rho` is × 1e9 (matching the
 * on-chain SVI encoding used by the predict-server API).
 */
export interface SVIRaw {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

/**
 * A snapshot of the predict market at publish time. Captures SVI, spot /
 * forward, IVs at 5 standard strikes relative to spot, and the last
 * 30 spot price points. All money values are in USD (already divided by
 * PRICE_SCALE).
 */
export interface PredictSnapshot {
  oracleId: string;
  expiryMs: number;
  spot: number;
  forward: number;
  svi: SVIRaw;
  standardStrikes: Array<{ strike: number; up: number; down: number; iv: number }>;
  recentPrices: Array<{ time: number; spot: number }>;
}

/**
 * Reference to the DeepBook Predict oracle the insight is anchored to.
 */
export interface DbOracleRef {
  oracleId: string;
  expiryMs: number;
  question: string;
}

/**
 * Live cross-venue data captured at insight-publish time. Either side
 * is `null` if no matching group was found within the matching tolerance.
 *
 * `dbComputed` carries the DeepBook Predict ladder synthesized from the
 * oracle's SVI surface (5 strikes + 3 range bands). This is the same
 * ladder the user sees in the LiveComparePanel — sending it to the AI
 * means the model can do a real 3-way cross-venue comparison instead of
 * just naming Polymarket vs Kalshi.
 */
export interface LiveIncludes {
  db: DbOracleRef;
  dbComputed?: {
    spotUsd: number;
    forwardUsd: number;
    upDown: Array<{
      strikeUsd: number;
      impliedProbUp: number;
      description: string | null;
      priceToBeatUsd: number | null;
    }>;
    range: Array<{
      floorStrikeUsd: number;
      capStrikeUsd: number;
      rangeBandPct: number;
      impliedProbUp: number;
      description: string | null;
    }>;
  } | null;
  poly: PolymarketGroup | null;
  kalshi: KalshiGroup | null;
}

/**
 * The JSON body that gets serialized and saved to localStorage. Two parts:
 *  - `analysis` — auto-generated markdown, what a human reader sees.
 *  - `includes` — the raw data backing that markdown, so programmatic
 *    consumers don't have to re-fetch from upstream APIs.
 */
export interface InsightBody {
  title: string;
  asset: InsightAsset;
  timestamp: number;
  tag?: string;
  source?: string;
  analysis: string;
  includes: {
    predict?: PredictSnapshot;
    live?: LiveIncludes;
  };
}

export interface InsightBodyInput {
  title: string;
  asset: InsightAsset;
  timestamp: number;
  tag?: string;
  source?: string;
  /** Pre-computed (AI-generated) markdown analysis. */
  analysis: string;
  includes: InsightBody['includes'];
}

// ─── Display helpers ───────────────────────────────────────────────────────

/**
 * Compact countdown like "in 2d 4h" / "in 8h" / "in 45m". Returns
 * "expired" for non-positive durations and "in <1m" for sub-minute
 * remaining time.
 */
export function formatTimeUntil(targetMs: number, now: number = Date.now()): string {
  const diffMs = targetMs - now;
  if (diffMs <= 0) return 'expired';

  const totalMin = Math.floor(diffMs / 60_000);
  if (totalMin < 1)  return 'in <1m';
  if (totalMin < 60) return `in ${totalMin}m`;

  const totalH = Math.floor(totalMin / 60);
  if (totalH < 24)   return `in ${totalH}h`;

  const totalD = Math.floor(totalH / 24);
  const remH = totalH % 24;
  if (remH === 0)    return `in ${totalD}d`;
  return `in ${totalD}d ${remH}h`;
}

/**
 * Human-readable expiry label with a relative countdown.
 * Example: 1749056400000 (4 Jun 2026 17:00 UTC) viewed 2 Jun 2026
 * 13:00 UTC → "Thu 4 Jun · 17:00 UTC · in 2d 4h".
 */
export function formatExpiryLabel(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const dayName  = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const datePart = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time     = d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  });
  return `${dayName} ${datePart} · ${time} UTC · ${formatTimeUntil(ms, now)}`;
}

// ─── Payload builder ────────────────────────────────────────────────────────

/**
 * Build the JSON body that gets serialized and saved locally. The
 * markdown `analysis` is supplied by the caller (AI-generated at
 * publish time, not templated). Optional fields are omitted so the
 * local payload stays minimal.
 */
export function buildInsightBody(input: InsightBodyInput): InsightBody {
  const body: InsightBody = {
    title: input.title,
    asset: input.asset,
    timestamp: input.timestamp,
    analysis: input.analysis,
    includes: input.includes,
  };
  if (input.tag?.trim()) body.tag = input.tag.trim();
  if (input.source?.trim()) body.source = input.source.trim();
  return body;
}

// ─── Saved insights table row type ─────────────────────────────────────────

/**
 * A row in the saved-insights table. Combines the local store's
 * persisted body with an id, a creation timestamp, and the on-disk byte
 * count. Bodies are stored inline (no separate blob fetch) so any row
 * can be opened without a network round-trip.
 */
export interface SavedInsight {
  id: string;
  body: InsightBody;
  createdAt: number;
  sourceBytes: number;
}
