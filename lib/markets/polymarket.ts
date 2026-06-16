/**
 * Polymarket Gamma API fetcher. Public REST, no authentication.
 *
 * The Lambda runs this on a 15-minute schedule and writes one BinaryMarket
 * row per (event, market, outcome). Outcomes and prices come back as
 * double-encoded JSON strings, e.g. `"[\"Yes\", \"No\"]"` and
 * `"[\"0.20\", \"0.80\"]"` — they must be JSON.parse'd twice.
 *
 * Endpoint: `GET /events?tag_id=235&active=true&closed=false&limit=200`.
 * tag_id=235 is the "bitcoin" tag — this server-filters to every active
 * BTC event (up/down, multi-strike ladder, range ladder, and intraday
 * "Bitcoin Up or Down" 5-minute markets). The /events response embeds
 * each event's nested `markets[]`, so one round trip per page.
 *
 * Per-market strike and range bounds come from `groupItemTitle`:
 *   - "↑ 200,000"  → strike=200000  (up/down multi-strike ladder)
 *   - "↓ 85,000"   → strike=85000   (dip-to variant)
 *   - "54,000-56,000" → range [54000, 56000]
 *   - "by September 30, 2025" → no strike (date-ladder)
 *   - "" / undefined → no strike (intraday "Up or Down" or single-strike)
 */

import type { BinaryMarket, Category, MarketType, Outcome } from "./types";
import { binaryMarketId } from "./id";

const BASE = "https://gamma-api.polymarket.com";

interface RawEvent {
  id: string;
  ticker?: string;
  slug: string;
  title: string;
  description?: string;
  category?: string;
  /**
   * Event-level tags. The "bitcoin" tag (id 235) lives HERE, not on
   * individual markets — every market in a BTC event inherits the tag
   * from its parent event. (Confirmed: 0/334 BTC markets had a
   * market-level bitcoin tag; 100/100 events had the event-level tag.)
   */
  tags?: Array<{ id?: string; slug?: string; label?: string }>;
  startDate?: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  volume?: number;
  volume24hr?: number;
  liquidity?: number;
  markets?: RawMarket[];
  series?: Array<{ ticker?: string; slug?: string; cgAssetName?: string }>;
}

interface RawMarket {
  id?: string;
  conditionId?: string;
  slug?: string;
  question?: string;
  description?: string;
  outcomes?: string;        // JSON-encoded string of array
  outcomePrices?: string;   // JSON-encoded string of array
  volume?: string | number;
  volumeNum?: number;
  volume24hr?: number;
  volume24hrClob?: number;
  liquidity?: string | number;
  liquidityNum?: number;
  bestBid?: string | number;
  bestAsk?: string | number;
  spread?: number;
  lastTradePrice?: number;
  startDate?: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  /**
   * Per-market label inside a multi-market event. Carries either a
   * dollar strike (e.g. "↑ 200,000", "↓ 85,000", "54,000-56,000") or
   * a date (e.g. "by September 30, 2025"). Empty string on single-market
   * events. Undefined on intraday "Bitcoin Up or Down" events.
   *
   * Note: this is the ONLY signal for true range markets on Polymarket —
   * `groupItemRange` is a UI bucket hint (e.g. which $25k bucket a
   * strike falls in) and exists on regular up/down markets, NOT on
   * range markets. Range markets store their band in `groupItemTitle`
   * as "low-high".
   */
  groupItemTitle?: string;
  groupItemThreshold?: string;
  /**
   * UI bucket hint. `["175000","200000"]` means "this strike is in the
   * $175k–$200k bucket". This is NOT a range market — these are
   * regular up/down markets with a UI grouping hint. Ignored by us.
   */
  groupItemRange?: string;
  /**
   * Per-market tags. For BTC markets under tag_id=235 events, this is
   * typically EMPTY — the bitcoin tag lives on the parent event. Kept
   * here for completeness; not used for filtering.
   */
  tags?: Array<{ id?: string; slug?: string; label?: string }>;
  categories?: Array<{ id?: string; slug?: string; label?: string }>;
}

/**
 * /public-search returns a wrapper with three top-level arrays: events,
 * markets, and profiles. We don't use it — we hit /events?tag_id=235
 * directly. Kept here for reference / future use.
 */
// interface RawSearchResponse {
//   events?: RawEvent[];
//   markets?: RawMarket[];
//   profiles?: unknown[];
// }

async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const t = Date.now();
  const res = await fetch(url, { signal });
  if (!res.ok) {
    console.warn(`[polymarket] HTTP ${res.status} for ${url} in ${Date.now() - t}ms`);
    throw new Error(`Polymarket HTTP ${res.status} for ${url}`);
  }
  const data = (await res.json()) as T;
  console.log(`[polymarket] HTTP ${res.status} for ${url} in ${Date.now() - t}ms`);
  return data;
}

function decodeJsonArray<T = string>(raw: string | undefined | null): T[] {
  if (!raw) return [];
  try {
    const once = JSON.parse(raw);
    if (typeof once === "string") return JSON.parse(once) as T[];
    if (Array.isArray(once)) return once as T[];
    return [];
  } catch {
    return [];
  }
}

function toNumber(x: string | number | undefined | null): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function toCategory(raw: string | undefined, tags: RawEvent["tags"]): Category {
  const lc = (raw ?? "").toLowerCase();
  const tagStr = (tags ?? []).map((t) => (t.label ?? t.slug ?? "")).join(" ").toLowerCase();
  const hay = `${lc} ${tagStr}`;
  if (hay.includes("crypto") || hay.includes("bitcoin") || hay.includes("ethereum")) return "CRYPTO";
  if (hay.includes("sport") || hay.includes("nba") || hay.includes("nfl")) return "SPORTS";
  if (hay.includes("politic") || hay.includes("election") || hay.includes("trump")) return "POLITICS";
  return "OTHER";
}

function toSubcategory(
  category: Category,
  question: string,
  tags: RawEvent["tags"],
): string | null {
  if (category !== "CRYPTO") {
    const tagLabel = tags?.[0]?.label ?? tags?.[0]?.slug ?? null;
    return tagLabel ? String(tagLabel) : null;
  }
  const lc = question.toLowerCase();
  if (lc.includes("bitcoin") || lc.includes("btc")) return "Bitcoin";
  if (lc.includes("ethereum") || lc.includes("eth")) return "Ethereum";
  if (lc.includes("solana") || lc.includes("sol")) return "Solana";
  const tagLabel = tags?.[0]?.label ?? tags?.[0]?.slug ?? null;
  return tagLabel ? String(tagLabel) : "Crypto";
}

function toMarketType(question: string): MarketType {
  const lc = question.toLowerCase();
  // RANGE: anything that names a band — "between", "range", or two $ amounts
  // joined by "-" / "to" / "and" (e.g. "$50k-$60k", "between $50k and $60k").
  if (lc.includes("between") || lc.includes("range")) return "RANGE";
  if (/\$\s*[\d,.]+[kKmM]?\s*[-–—]\s*\$?\s*[\d,.]+[kKmM]?/.test(lc)) return "RANGE";
  // UP_DOWN: directional language OR a yes/no price target phrased as
  // hit / reach / exceed / drop / fall / dip / touch / close / trade.
  // Catches the common Polymarket BTC shapes:
  //   "Will Bitcoin hit $150k by …?"
  //   "Will Bitcoin be above $54,000 on June 15?"
  //   "Will Bitcoin dip to $57,500 in June?"   (dip to = drop to)
  //   "Will Bitcoin fall to $40,000 this year?"
  const upDownVerbs = ["up or down", "above", "below", "over", "under",
    "hit ", "hits ", "reach", "exceed", "top", "drop", "drops",
    "falls", "fall to", "dip to", "dip ", "touch",
    "close above", "close below", "trade above", "trade below"];
  if (upDownVerbs.some((v) => lc.includes(v)) || lc.includes(">") || lc.includes("<")) return "UP_DOWN";
  return "OTHER";
}

function toOutcome(name: string): Outcome {
  const lc = name.toLowerCase();
  if (lc === "yes" || lc === "up") return lc === "up" ? "UP" : "YES";
  if (lc === "no" || lc === "down") return lc === "down" ? "DOWN" : "NO";
  return "OTHER";
}

function toExpiryMs(endDate: string | undefined): number | null {
  if (!endDate) return null;
  const ms = new Date(endDate).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Parse a Polymarket `groupItemTitle` value into either a strike (single
 * number) or a range (floor + cap). Returns null for non-numeric labels
 * like "by September 30, 2025" or empty/missing values.
 *
 * Recognized shapes (from real /events?tag_id=235 response):
 *   - "↑ 200,000"  → { strike: 200000 }
 *   - "↓ 85,000"   → { strike: 85000 }   (dip-to / drop-to)
 *   - "200,000"    → { strike: 200000 }  (no arrow)
 *   - "54,000-56,000" → { range: [54000, 56000] }  (true range market)
 *   - "54,000–56,000" → { range: [54000, 56000] }  (en-dash variant)
 *   - "by September 30, 2025" → null    (date-ladder, no strike)
 *   - "" / undefined → null              (single-strike or intraday)
 *
 * NOT parsed:
 *   - groupItemRange (e.g. `["175000","200000"]`) — that's a UI bucket
 *     hint on up/down markets, NOT a range market.
 */
function parseGroupItemTitle(
  raw: string | undefined | null,
): { strike: number } | { range: [number, number] } | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;

  // Range: "low-high" with either hyphen-minus, en-dash, or em-dash.
  // Comma thousands separators allowed; decimals allowed.
  const rangeMatch = t.match(
    /^([\d,]+(?:\.\d+)?)\s*[-–—]\s*([\d,]+(?:\.\d+)?)$/,
  );
  if (rangeMatch) {
    const floor = Number(rangeMatch[1].replace(/,/g, ""));
    const cap = Number(rangeMatch[2].replace(/,/g, ""));
    if (Number.isFinite(floor) && Number.isFinite(cap) && cap > floor) {
      return { range: [floor, cap] };
    }
    return null;
  }

  // Strike: optional ↑/↓ arrow, then a number with optional commas/decimal.
  const strikeMatch = t.match(/^[↑↓]?\s*([\d,]+(?:\.\d+)?)$/);
  if (strikeMatch) {
    const n = Number(strikeMatch[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return { strike: n };
  }

  // Anything else (date, text, etc.) — no strike.
  return null;
}

/**
 * BTC filter. The server already filters via tag_id=235, but as a
 * defensive belt-and-suspenders we still check the parent event's tags
 * here. We do NOT check market-level tags — the bitcoin tag lives on
 * the event, not on individual markets (verified: 0/334 BTC markets
 * had a market-level bitcoin tag, vs 100/100 events).
 */
function isBitcoinEvent(e: RawEvent): boolean {
  if ((e.tags ?? []).some((t) => t.slug === "bitcoin" || t.label === "Bitcoin")) return true;
  if ((e.series ?? []).some((s) => s.cgAssetName === "bitcoin")) return true;
  return false;
}

/**
 * Pull active crypto markets from Polymarket. Returns one BinaryMarket row
 * per (event, market, outcome) — for binary markets that's 2 rows per
 * market, for multi-outcome markets up to N rows.
 *
 * Strategy: hit /events?tag_id=235 (the bitcoin tag). This server-filters
 * to every active BTC event — up/down, multi-strike ladder, range ladder,
 * and intraday "Bitcoin Up or Down" 5-minute markets — in one round trip.
 * Each event embeds its markets[], so we walk event → market.
 */
export async function fetchPolymarketMarkets(
  signal?: AbortSignal,
): Promise<BinaryMarket[]> {
  const url = `${BASE}/events?tag_id=235&active=true&closed=false&limit=200`;
  console.log(`[polymarket] GET ${url}`);
  const events = await fetchJSON<RawEvent[]>(url, signal);
  console.log(`[polymarket] received ${events.length} events`);

  const now = new Date().toISOString();
  const out: BinaryMarket[] = [];
  let btcEventCount = 0;
  let totalMarketsSeen = 0;
  let closedSkipped = 0;
  let noOutcomesSkipped = 0;
  let noTagSkipped = 0;
  let horizonSkipped = 0;
  let expiredSkipped = 0;
  let upDownRows = 0;
  let rangeRows = 0;
  let otherRows = 0;

  // Markets with expiry more than this many days in the future are
  // dropped — they're not actionable in the next trading window.
  const MAX_HORIZON_DAYS = 30;
  const MAX_HORIZON_MS = MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  // Markets expiring within this buffer (or already expired) are
  // dropped — same value as DeepBook's EXPIRY_BUFFER_MS for cross-
  // source consistency.
  const EXPIRY_BUFFER_MS = 60_000;
  const nowMs = Date.now();

  for (const e of events) {
    // Defensive BTC check. The server already filtered by tag_id=235,
    // but we re-check the parent event's tags here as a safety net
    // (e.g. if tag IDs change, or if upstream returns stale data).
    if (!isBitcoinEvent(e)) {
      noTagSkipped += 1;
      continue;
    }
    btcEventCount += 1;

    for (const m of e.markets ?? []) {
      totalMarketsSeen += 1;
      if (m.closed || m.active === false) {
        closedSkipped += 1;
        continue;
      }

      // 30-day horizon filter: drop markets expiring more than 30 days out
      // (e.g. the long-dated "When will Bitcoin hit $150k?" date-ladder).
      const expiryCheck = m.endDate ? new Date(m.endDate).getTime() : NaN;
      if (Number.isFinite(expiryCheck) && expiryCheck > nowMs + MAX_HORIZON_MS) {
        horizonSkipped += 1;
        continue;
      }
      // 60s expiry filter: drop markets that have already expired or are
      // about to expire in the next 60s. Mirrors DeepBook's EXPIRY_BUFFER_MS.
      if (Number.isFinite(expiryCheck) && expiryCheck <= nowMs + EXPIRY_BUFFER_MS) {
        expiredSkipped += 1;
        continue;
      }

      const outcomes = decodeJsonArray<string>(m.outcomes);
      const prices = decodeJsonArray<string>(m.outcomePrices);
      if (outcomes.length === 0 || outcomes.length !== prices.length) {
        noOutcomesSkipped += 1;
        continue;
      }

      const eventUrl = e.slug
        ? `https://polymarket.com/event/${e.slug}`
        : m.slug
        ? `https://polymarket.com/market/${m.slug}`
        : "";
      const bestBid = toNumber(m.bestBid);
      const bestAsk = toNumber(m.bestAsk);
      const volume24hUsd = toNumber(m.volume24hr ?? m.volume);
      const expiryMs = toExpiryMs(m.endDate);

      // Classify via groupItemTitle (the structured signal), then
      // fall back to the question-text heuristic for "between" / "$\d+-$".
      const parsed = parseGroupItemTitle(m.groupItemTitle);
      let marketType: MarketType;
      let strikeUsd: number | null;
      let floorStrikeUsd: number | null = null;
      let capStrikeUsd: number | null = null;

      if (parsed && "range" in parsed) {
        // True range market (e.g. "Bitcoin price on June 15?" with
        // groupItemTitle "54,000-56,000").
        marketType = "RANGE";
        floorStrikeUsd = parsed.range[0];
        capStrikeUsd = parsed.range[1];
        strikeUsd = (floorStrikeUsd + capStrikeUsd) / 2;
      } else if (parsed && "strike" in parsed) {
        // Multi-strike ladder (e.g. "↑ 200,000", "↓ 85,000").
        marketType = "UP_DOWN";
        strikeUsd = parsed.strike;
      } else {
        // No structured signal. Fall back to the question-text heuristic
        // (handles "between $X and $Y" and single-strike "above/below $X").
        marketType = toMarketType(m.question ?? "");
        strikeUsd = null;
      }

      if (marketType === "UP_DOWN") upDownRows += outcomes.length;
      else if (marketType === "RANGE") rangeRows += outcomes.length;
      else otherRows += outcomes.length;

      for (let i = 0; i < outcomes.length; i++) {
        const prob = Number(prices[i]);
        if (!Number.isFinite(prob)) continue;
        const outcome = toOutcome(outcomes[i]);
        const externalId = m.id ?? m.slug ?? "";
        out.push({
          id: binaryMarketId("POLYMARKET", externalId, outcome),
          platform: "POLYMARKET",
          externalId,
          externalEventId: e.id ?? null,
          question: m.question ?? "",
          description: m.description ?? null,
          category: "CRYPTO",
          subcategory: "Bitcoin",
          outcome,
          impliedProb: Math.max(0, Math.min(1, prob)),
          bestBidUsd: bestBid,
          bestAskUsd: bestAsk,
          volume24hUsd,
          strikeUsd,
          floorStrikeUsd,
          capStrikeUsd,
          expiryMs,
          marketType,
          url: eventUrl,
          rawJson: JSON.stringify({ event: e, market: m }),
          fetchedAt: now,
        });
      }
    }
  }

  console.log(
    `[polymarket] summary: ${btcEventCount}/${events.length} BTC events, ` +
    `${totalMarketsSeen} markets seen, ` +
    `${closedSkipped} closed-skipped, ${noOutcomesSkipped} no-outcomes-skipped, ` +
    `${noTagSkipped} no-bitcoin-tag-skipped, ${horizonSkipped} horizon-skipped (>${MAX_HORIZON_DAYS}d), ` +
    `${expiredSkipped} expired-skipped (<= ${EXPIRY_BUFFER_MS / 1000}s)`,
  );
  console.log(
    `[polymarket] outcome rows: ${out.length} total ` +
    `(up/down=${upDownRows}, range=${rangeRows}, other=${otherRows})`,
  );

  if (out.length > 0) {
    console.log(`[polymarket] first row sample:`, JSON.stringify({
      platform: out[0].platform,
      question: out[0].question.slice(0, 60),
      outcome: out[0].outcome,
      impliedProb: out[0].impliedProb,
      marketType: out[0].marketType,
      strikeUsd: out[0].strikeUsd,
      floorStrikeUsd: out[0].floorStrikeUsd,
      capStrikeUsd: out[0].capStrikeUsd,
      volume24hUsd: out[0].volume24hUsd,
    }));
  }

  return out;
}

/**
 * Range band width as a percentage of the band midpoint, used by the
 * range card to display "±N%". Exported so callers (e.g. SearchResults)
 * can recompute the same value without duplicating the formula.
 */
export function polymarketRangeBandPct(m: BinaryMarket): number {
  if (
    m.marketType === "RANGE" &&
    m.floorStrikeUsd != null &&
    m.capStrikeUsd != null
  ) {
    const mid = (m.floorStrikeUsd + m.capStrikeUsd) / 2;
    if (mid > 0) {
      return ((m.capStrikeUsd - m.floorStrikeUsd) / mid) * 100;
    }
  }
  return 0;
}

/**
 * A group of Polymarket markets that share the same (event, expiry).
 * One group can carry BOTH an UP_DOWN ladder and a RANGE ladder for
 * the same event+expiry, so the rendering can put the two card types
 * side-by-side in a 2-col grid.
 */
export interface PolymarketGroup {
  /** `${externalEventId}::${expiryMs}` */
  key: string;
  externalEventId: string | null;
  externalId: string;
  question: string;
  expiryMs: number;
  /** One row per strike in a multi-strike UP_DOWN ladder (empty if none). */
  upDown: { strikeUsd: number; impliedProbUp: number }[];
  /** One row per (floor, cap) band in a RANGE ladder (empty if none). */
  range: {
    floorStrikeUsd: number;
    capStrikeUsd: number;
    rangeBandPct: number;
    impliedProbUp: number;
  }[];
}

/**
 * Group raw Polymarket BinaryMarket rows into render-ready PolymarketGroup
 * objects. Drops OTHER (single YES/NO) markets, dedupes YES/UP rows
 * (NO/DOWN rows are the complement and would double-count). UP_DOWN
 * and RANGE markets for the same (event, expiry) share a group so the
 * cards can be rendered side-by-side.
 *
 * Sort order: earliest expiry first.
 */
export function groupPolymarketMarkets(rows: BinaryMarket[]): PolymarketGroup[] {
  const byKey = new Map<string, PolymarketGroup>();
  for (const m of rows) {
    if (m.marketType !== "UP_DOWN" && m.marketType !== "RANGE") continue;
    // YES/UP row carries the implied prob; NO/DOWN row is the complement.
    const isYes = m.outcome === "YES" || m.outcome === "UP";
    if (!isYes) continue;
    const expiry = m.expiryMs ?? 0;
    const key = `${m.externalEventId ?? m.externalId}::${expiry}`;
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        externalEventId: m.externalEventId,
        externalId: m.externalId,
        question: m.question,
        expiryMs: expiry,
        upDown: [],
        range: [],
      };
      byKey.set(key, group);
    }
    if (m.marketType === "UP_DOWN") {
      group.upDown.push({
        strikeUsd: m.strikeUsd ?? 0,
        impliedProbUp: m.impliedProb,
      });
    } else {
      group.range.push({
        floorStrikeUsd: m.floorStrikeUsd ?? 0,
        capStrikeUsd: m.capStrikeUsd ?? 0,
        rangeBandPct: polymarketRangeBandPct(m),
        impliedProbUp: m.impliedProb,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.expiryMs - b.expiryMs);
}
