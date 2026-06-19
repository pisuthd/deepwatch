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
 *
 * Ported from frontend/lib/markets/match.ts so the frontend can resolve
 * it via @/app/lib/match without depending on the old frontend/lib/markets
 * copy. Identical logic.
 *
 * `findMarketMatches` is a second, simpler join used by the Compare
 * page: bucket all three sources by `${expiryMs}::${asset}`, keep the
 * first group per venue per bucket, and return a per-bucket headline
 * probability per venue. Complexity is O((P+K+D) log N) thanks to the
 * bucketed join. Per-row strike matching is deferred to the drilldown.
 */

import type { PolymarketGroup } from "./polymarket";
import type { KalshiGroup } from "./kalshi";
import type { DeepBookGroup } from "./deepbook";
import { formatExpiryDate } from "./format";

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

/**
 * Strike tolerance for cross-venue strike matching. Strikes within this
 * dollar amount of a DB pre-generated strike are considered "the same
 * strike" for the comparison table — Polymarket and Kalshi often anchor
 * to a slightly different tick (e.g. DB $54,750 vs Poly $54,800), so
 * exact equality would miss most of the cross-venue surface.
 */
const STRIKE_TOLERANCE_USD = 1000;

/**
 * All Polymarket/Kalshi strikes across every group that fall within the
 * DB oracle's strike range (loosened by STRIKE_TOLERANCE_USD). Used by
 * the modal to show every cross-venue row, not just the strikes the
 * closest-by-expiry group happens to carry.
 */
function collectStrikesInRange<
  G extends {
    upDown: { strikeUsd: number; impliedProbUp: number }[];
    range: { impliedProbUp: number }[];
  },
>(groups: G[], dbStrikes: number[]): { strikeUsd: number; impliedProbUp: number }[] {
  if (dbStrikes.length === 0) return [];
  const min = Math.min(...dbStrikes) - STRIKE_TOLERANCE_USD;
  const max = Math.max(...dbStrikes) + STRIKE_TOLERANCE_USD;
  const seen = new Set<number>();
  const out: { strikeUsd: number; impliedProbUp: number }[] = [];
  for (const g of groups) {
    for (const row of g.upDown) {
      if (
        row.strikeUsd > 0 &&
        row.impliedProbUp > 0 &&
        row.strikeUsd >= min &&
        row.strikeUsd <= max &&
        !seen.has(row.strikeUsd)
      ) {
        seen.add(row.strikeUsd);
        out.push({ strikeUsd: row.strikeUsd, impliedProbUp: row.impliedProbUp });
      }
    }
  }
  return out.sort((a, b) => a.strikeUsd - b.strikeUsd);
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

// ─── findMarketMatches (Compare page) ───────────────────────────────────

/** A single cross-venue match — at least 2 of 3 venues present. */
export interface Match {
  /** `${expiryMs}::${asset}` — stable per-bucket key. */
  key: string;
  /** Poly question if present, else Kalshi, else a generic fallback. */
  question: string;
  /** Expiry in epoch ms. */
  expiryMs: number;
  /** Asset symbol (today always 'BTC', but the field is forward-compat). */
  asset: string;
  poly?: PolymarketGroup;
  kalshi?: KalshiGroup;
  deepBook?: DeepBookGroup;
  /** Headline probability per venue (0–1). Undefined when the venue is absent. */
  polyProb?: number;
  kalshiProb?: number;
  deepBookProb?: number;
  /** max(probs) − min(probs). Undefined when fewer than 2 venues have data. */
  spread?: number;
}

export interface FindMarketMatchesOptions {
  /**
   * Live spot USD (already scaled to dollars, not raw Sui units). When
   * provided, the per-venue headline probability for up/down groups is
   * the row closest to spot. When null/undefined, falls back to "first
   * up/down row" / "middle range band" — still a useful number, just
   * not ATM-anchored.
   */
  spotUsd?: number | null;
}

const fallbackQuestion = (asset: string, expiryMs: number): string => {
  const d = new Date(expiryMs);
  const stamp = d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
  return `${asset} market · ${stamp} UTC`;
};

/**
 * Question text derived from the DeepBook Predict oracle itself. The
 * oracle is the row's identity, so this is what the Market column should
 * display — not the nearest Polymarket/Kalshi competitor's framing.
 *
 *   Up/Down ladder present → "BTC Up/Down @ $65k · Jun 26, 08:00 UTC"
 *     (median strike of the 5-strike ladder, snapped to display tick)
 *   Range ladder present    → "BTC in $63k–$67k · Jun 26, 08:00 UTC"
 *     (narrowest band the oracle publishes)
 *   No ladder               → "BTC price · Jun 26, 08:00 UTC"
 *     (final fallback; the ladder is filtered out when probs collapse
 *     to 0/1, which is rare)
 */
function dbQuestionForGroup(db: DeepBookGroup): string {
  const expiry = formatExpiryDate(db.expiryMs);
  if (db.upDown.length > 0) {
    const strikes = db.upDown
      .map((r) => r.strikeUsd)
      .filter((s) => Number.isFinite(s) && s > 0)
      .sort((a, b) => a - b);
    if (strikes.length > 0) {
      const median = strikes[Math.floor(strikes.length / 2)];
      return `${db.asset} Up/Down @ $${Math.round(median / 1000)}k · ${expiry}`;
    }
  }
  if (db.range.length > 0) {
    const band = db.range[0];
    if (
      band.floorStrikeUsd !== null &&
      band.capStrikeUsd !== null &&
      band.floorStrikeUsd > 0 &&
      band.capStrikeUsd > 0
    ) {
      const f = Math.round(band.floorStrikeUsd / 1000);
      const c = Math.round(band.capStrikeUsd / 1000);
      return `${db.asset} in $${f}k–$${c}k · ${expiry}`;
    }
  }
  return `${db.asset} price · ${expiry}`;
}

/**
 * Headline probability for a single group:
 *   - If upDown has rows and spotUsd is known → the row whose strike is
 *     closest to spot (ATM row).
 *   - Else if upDown has rows (no spot) → first row, or sole row if
 *     exactly one (Polymarket "Up or Down" markets).
 *   - Else if range has rows → middle band.
 *   - Else: undefined.
 */
function headlineProbForGroup<
  T extends {
    upDown: { strikeUsd: number; impliedProbUp: number }[];
    range: { impliedProbUp: number }[];
  },
>(group: T, spotUsd: number | null | undefined): number | undefined {
  if (group.upDown.length > 0) {
    if (spotUsd !== null && spotUsd !== undefined && spotUsd > 0) {
      let best = group.upDown[0];
      let bestDiff = Math.abs(best.strikeUsd - spotUsd);
      for (let i = 1; i < group.upDown.length; i += 1) {
        const d = Math.abs(group.upDown[i].strikeUsd - spotUsd);
        if (d < bestDiff) {
          best = group.upDown[i];
          bestDiff = d;
        }
      }
      return best.impliedProbUp;
    }
    return group.upDown[0].impliedProbUp;
  }
  if (group.range.length > 0) {
    const mid = Math.floor(group.range.length / 2);
    return group.range[mid].impliedProbUp;
  }
  return undefined;
}

/**
 * Bucket all three sources by `${expiryMs}::${asset}`. For each bucket
 * take the first group from each venue, compute a headline probability
 * per venue, and emit a match when ≥2 venues have data. Per-row strike
 * matching is deferred to the drilldown — the grid only needs the
 * headline prob.
 *
 * Result is sorted by `expiryMs` ascending; the page re-sorts by the
 * user's sort selector.
 */
export function findMarketMatches(
  polyGroups: PolymarketGroup[],
  kalshiGroups: KalshiGroup[],
  deepBookGroups: DeepBookGroup[],
  opts: FindMarketMatchesOptions = {},
): Match[] {
  const { spotUsd = null } = opts;

  type Bucket = {
    expiryMs: number;
    asset: string;
    poly?: PolymarketGroup;
    kalshi?: KalshiGroup;
    deepBook?: DeepBookGroup;
  };

  const buckets = new Map<string, Bucket>();

  const upsert = (expiryMs: number, asset: string): Bucket => {
    const k = `${expiryMs}::${asset}`;
    let b = buckets.get(k);
    if (!b) {
      b = { expiryMs, asset };
      buckets.set(k, b);
    }
    return b;
  };

  for (const g of polyGroups) {
    if (!g.expiryMs) continue;
    const b = upsert(g.expiryMs, "BTC");
    if (!b.poly) b.poly = g;
  }
  for (const g of kalshiGroups) {
    if (!g.expiryMs) continue;
    const b = upsert(g.expiryMs, "BTC");
    if (!b.kalshi) b.kalshi = g;
  }
  for (const g of deepBookGroups) {
    if (!g.expiryMs) continue;
    const b = upsert(g.expiryMs, g.asset || "BTC");
    if (!b.deepBook) b.deepBook = g;
  }

  const out: Match[] = [];
  for (const [key, b] of buckets) {
    const venuesPresent = [b.poly, b.kalshi, b.deepBook].filter(
      (v) => v !== undefined,
    ).length;
    if (venuesPresent < 2) continue;

    const polyProb = b.poly ? headlineProbForGroup(b.poly, spotUsd) : undefined;
    const kalshiProb = b.kalshi
      ? headlineProbForGroup(b.kalshi, spotUsd)
      : undefined;
    const deepBookProb = b.deepBook
      ? headlineProbForGroup(b.deepBook, spotUsd)
      : undefined;

    const probs = [polyProb, kalshiProb, deepBookProb].filter(
      (p): p is number => typeof p === "number",
    );
    const spread =
      probs.length >= 2 ? Math.max(...probs) - Math.min(...probs) : undefined;

    const question =
      b.poly?.question?.trim() ||
      b.kalshi?.question?.trim() ||
      fallbackQuestion(b.asset, b.expiryMs);

    out.push({
      key,
      question,
      expiryMs: b.expiryMs,
      asset: b.asset,
      poly: b.poly,
      kalshi: b.kalshi,
      deepBook: b.deepBook,
      polyProb,
      kalshiProb,
      deepBookProb,
      spread,
    });
  }

  out.sort((a, b) => a.expiryMs - b.expiryMs);
  return out;
}

// ─── findMatchesForDeepBook (Compare page, table view) ──────────────────

/**
 * A row in the Compare table — anchored on one DeepBook Predict oracle
 * (the protocol's native market), with the closest-by-expiry Polymarket
 * and Kalshi matches attached for comparison.
 *
 * `dbProb` is always populated (DeepBook is the base); the Poly/Kalshi
 * probs are present when a match is found within `EXPIRY_TOLERANCE_MS`.
 */
export interface DeepBookMatch {
  /** `${oracleId}::${expiryMs}` — stable per-row key. */
  key: string;
  oracleId: string;
  /**
   * Question derived from the DeepBook Predict oracle itself (the base).
   * Always present. Format: "BTC Up/Down @ $65k · Jun 26, 08:00 UTC" or
   * "BTC in $63k–$67k · Jun 26, 08:00 UTC". The DeepBook market is the
   * row's identity — Polymarket/Kalshi are the comparison surface.
   */
  dbQuestion: string;
  /** Polymarket question when matched (closest-by-expiry). */
  polyQuestion?: string;
  /** Kalshi question when matched (closest-by-expiry). */
  kalshiQuestion?: string;
  /**
   * Backwards-compat synthesized label. v1 callers that only need a
   * single string for the row can use this; new code should prefer the
   * explicit `dbQuestion` / `polyQuestion` / `kalshiQuestion` fields.
   * Equal to `dbQuestion` (the row's identity is the oracle, not the
   * nearest competitor's framing).
   */
  question: string;
  expiryMs: number;
  asset: string;
  spotUsd: number | null;
  forwardUsd: number | null;
  /** DeepBook headline prob — always present. */
  dbProb: number;
  /** Closest-by-expiry Polymarket headline prob, if any. */
  polyProb?: number;
  /** Closest-by-expiry Kalshi headline prob, if any. */
  kalshiProb?: number;
  /** max(probs) − min(probs). Undefined when only DB has data. */
  spread?: number;
  deepBook: DeepBookGroup;
  poly?: PolymarketGroup;
  kalshi?: KalshiGroup;
  /**
   * Every Polymarket strike within the DB oracle's strike range (across
   * all Polymarket groups, not just the closest-by-expiry one). The
   * modal renders this alongside the DB's pre-generated ladder so
   * the user sees the full cross-venue surface, not just whatever
   * strikes happen to share an exact expiry.
   */
  polyStrikes?: { strikeUsd: number; impliedProbUp: number }[];
  /** Same idea for Kalshi. */
  kalshiStrikes?: { strikeUsd: number; impliedProbUp: number }[];
  /** Polymarket URL of the closest-by-expiry group's event page. */
  polyUrl?: string;
  /** Kalshi URL of the closest-by-expiry group's market page. */
  kalshiUrl?: string;
}

/**
 * For each DeepBook group, find the closest-by-expiry Polymarket and
 * Kalshi group, compute per-venue headline probs, and return one row
 * per DeepBook oracle. The DeepBook side is the base; the Poly/Kalshi
 * columns are the comparison surface. Rows are sorted by `expiryMs`
 * ascending; the page re-sorts by the user's sort selector.
 */
export function findMatchesForDeepBook(
  deepBookGroups: DeepBookGroup[],
  polyGroups: PolymarketGroup[],
  kalshiGroups: KalshiGroup[],
  opts: FindMarketMatchesOptions = {},
): DeepBookMatch[] {
  const { spotUsd = null } = opts;

  const out: DeepBookMatch[] = [];

  for (const db of deepBookGroups) {
    if (!db.expiryMs) continue;
    const dbProb = headlineProbForGroup(db, spotUsd);
    if (dbProb === undefined) continue; // skip groups with no usable prob

    const poly = closestByExpiry(polyGroups, db.expiryMs, EXPIRY_TOLERANCE_MS);
    const kalshi = closestByExpiry(kalshiGroups, db.expiryMs, EXPIRY_TOLERANCE_MS);
    const polyProb = poly ? headlineProbForGroup(poly, spotUsd) : undefined;
    const kalshiProb = kalshi ? headlineProbForGroup(kalshi, spotUsd) : undefined;

    // Collect every Poly/Kalshi strike within the DB oracle's strike
    // range, across all groups. This gives the modal a full cross-venue
    // surface to render — the closest-by-expiry match above is just
    // the headline row; the per-strike table needs every strike.
    const dbStrikes = db.upDown
      .map((r) => r.strikeUsd)
      .filter((s) => s > 0);
    const polyStrikes = collectStrikesInRange(polyGroups, dbStrikes);
    const kalshiStrikes = collectStrikesInRange(kalshiGroups, dbStrikes);

    const probs: number[] = [dbProb];
    if (typeof polyProb === "number") probs.push(polyProb);
    if (typeof kalshiProb === "number") probs.push(kalshiProb);
    const spread = probs.length >= 2 ? Math.max(...probs) - Math.min(...probs) : undefined;

    // The DeepBook oracle is the row's identity. Its question is what the
    // Market column should display. Poly/Kalshi questions (when matched)
    // are surfaced as secondary context — they describe a *neighbouring*
    // market at the same expiry, not the row itself.
    const dbQuestion = dbQuestionForGroup(db);
    const polyQuestion = poly?.question?.trim() || undefined;
    const kalshiQuestion = kalshi?.question?.trim() || undefined;

    out.push({
      key: `${db.oracleId}::${db.expiryMs}`,
      oracleId: db.oracleId,
      dbQuestion,
      polyQuestion,
      kalshiQuestion,
      // Synthesised label kept for backwards compat with any caller that
      // still uses `match.question`. Equal to dbQuestion — the row's
      // identity is the oracle, never the competitor's framing.
      question: dbQuestion,
      expiryMs: db.expiryMs,
      asset: db.asset,
      spotUsd: db.spotUsd,
      forwardUsd: db.forwardUsd,
      dbProb,
      polyProb,
      kalshiProb,
      spread,
      deepBook: db,
      poly: poly ?? undefined,
      kalshi: kalshi ?? undefined,
      polyStrikes,
      kalshiStrikes,
      polyUrl: poly?.url,
      kalshiUrl: kalshi?.url,
    });
  }

  out.sort((a, b) => a.expiryMs - b.expiryMs);
  return out;
}