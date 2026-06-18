/**
 * Polymarket Gamma API fetcher. Public REST, no authentication.
 *
 * Polls `/events?tag_id=235&active=true&closed=false&limit=200` (the
 * "bitcoin" tag) and writes one BinaryMarket row per (event, market,
 * outcome). Outcomes and prices come back as double-encoded JSON strings
 * (e.g. `"[\"Yes\", \"No\"]"`), so they must be JSON.parse'd twice.
 *
 * Per-market strike and range bounds come from `groupItemTitle`:
 *   - "↑ 200,000"  → strike=200000  (up/down multi-strike ladder)
 *   - "↓ 85,000"   → strike=85000   (dip-to variant)
 *   - "54,000-56,000" → range [54000, 56000]
 *   - "by September 30, 2025" → no strike (date-ladder)
 *   - "" / undefined → no strike (intraday "Up or Down" or single-strike)
 *
 * Ported from the root app's lib/markets/polymarket.ts. The grouping
 * function is what makes the "apple-to-apple" comparison work — raw
 * rows from Polymarket's noise get reshaped into a sorted ladder that
 * lines up with the same ladder on Kalshi and the synthetic ladder we
 * build from DeepBook Predict's SVI surface.
 */

import type { BinaryMarket, Category, MarketType, Outcome } from "./types";
import { binaryMarketId } from "./id";

const BASE = "https://gamma-api.polymarket.com";
const BINANCE = "https://api.binance.com";

/**
 * Frontend view-time filter for near-certain markets. The grouping
 * function below drops any YES/UP row whose implied probability is
 * outside this band. 2%–98% catches the user's "99% / 1%" and
 * "100% / 0%" cases but keeps 3% / 97% markets.
 */
export const MIN_IMPLIED_PROB = 0.02;
export const MAX_IMPLIED_PROB = 0.98;

interface RawEvent {
  id: string;
  ticker?: string;
  slug: string;
  title: string;
  description?: string;
  category?: string;
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
  outcomes?: string;
  outcomePrices?: string;
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
  /** Used to fetch the "Price To Beat" for "Up or Down" markets. */
  eventStartTime?: string;
  closed?: boolean;
  active?: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  groupItemTitle?: string;
  groupItemThreshold?: string;
  groupItemRange?: string;
  tags?: Array<{ id?: string; slug?: string; label?: string }>;
  categories?: Array<{ id?: string; slug?: string; label?: string }>;
}

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
  if (lc.includes("between") || lc.includes("range")) return "RANGE";
  if (/\$\s*[\d,.]+[kKmM]?\s*[-–—]\s*\$?\s*[\d,.]+[kKmM]?/.test(lc)) return "RANGE";
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

function parseGroupItemTitle(
  raw: string | undefined | null,
): { strike: number } | { range: [number, number] } | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;

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

  const strikeMatch = t.match(/^[↑↓]?\s*([\d,]+(?:\.\d+)?)$/);
  if (strikeMatch) {
    const n = Number(strikeMatch[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return { strike: n };
  }

  return null;
}

function isBitcoinEvent(e: RawEvent): boolean {
  if ((e.tags ?? []).some((t) => t.slug === "bitcoin" || t.label === "Bitcoin")) return true;
  if ((e.series ?? []).some((s) => s.cgAssetName === "bitcoin")) return true;
  return false;
}

/**
 * Polymarket's `description` is sometimes a clean outcome label
 * ("$55,500 or above") and sometimes the full market rules text.
 * Heuristic: a clean label is short (< 60 chars) and doesn't read like
 * legalese. Anything longer or containing "resolve" / "resolution" /
 * "this market" is treated as rules text and replaced with null.
 */
function isCleanOutcomeLabel(desc: string | null | undefined): desc is string {
  if (!desc) return false;
  const t = desc.trim();
  if (t.length === 0 || t.length > 60) return false;
  const lc = t.toLowerCase();
  if (lc.includes("resolve") || lc.includes("resolution")) return false;
  if (lc.startsWith("this market")) return false;
  return true;
}

/**
 * Fetch the "Price To Beat" for a Polymarket "Up or Down" intraday
 * market — the BTC open price of the 1-hour candle at the market's
 * `eventStartTime`. Hits Binance's public klines API.
 */
async function fetchPriceToBeatUsd(
  eventStartTime: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const startMs = new Date(eventStartTime).getTime();
  if (!Number.isFinite(startMs)) return null;
  const candleStartMs = Math.floor(startMs / 3_600_000) * 3_600_000;
  const candleEndMs = candleStartMs + 3_600_000;
  const url = `${BINANCE}/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=${candleStartMs}&endTime=${candleEndMs}&limit=1`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || data.length === 0) return null;
    const open = Number((data[0] as unknown[])[1]);
    return Number.isFinite(open) ? open : null;
  } catch {
    return null;
  }
}

export async function fetchPolymarketMarkets(
  signal?: AbortSignal,
): Promise<BinaryMarket[]> {
  const url = `${BASE}/events?tag_id=235&active=true&closed=false&limit=200`;
  console.log(`[polymarket] GET ${url}`);
  const events = await fetchJSON<RawEvent[]>(url, signal);
  console.log(`[polymarket] received ${events.length} events`);

  const now = new Date().toISOString();
  const out: BinaryMarket[] = [];

  const MAX_HORIZON_DAYS = 30;
  const MAX_HORIZON_MS = MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const EXPIRY_BUFFER_MS = 60_000;
  const nowMs = Date.now();

  for (const e of events) {
    if (!isBitcoinEvent(e)) continue;

    for (const m of e.markets ?? []) {
      if (m.closed || m.active === false) continue;

      const expiryCheck = m.endDate ? new Date(m.endDate).getTime() : NaN;
      if (Number.isFinite(expiryCheck) && expiryCheck > nowMs + MAX_HORIZON_MS) continue;
      if (Number.isFinite(expiryCheck) && expiryCheck <= nowMs + EXPIRY_BUFFER_MS) continue;

      const outcomes = decodeJsonArray<string>(m.outcomes);
      const prices = decodeJsonArray<string>(m.outcomePrices);
      if (outcomes.length === 0 || outcomes.length !== prices.length) continue;

      const eventUrl = e.slug
        ? `https://polymarket.com/event/${e.slug}`
        : m.slug
          ? `https://polymarket.com/market/${m.slug}`
          : "";
      const bestBid = toNumber(m.bestBid);
      const bestAsk = toNumber(m.bestAsk);
      const volume24hUsd = toNumber(m.volume24hr ?? m.volume);
      const expiryMs = toExpiryMs(m.endDate);

      const parsed = parseGroupItemTitle(m.groupItemTitle);
      let marketType: MarketType;
      let strikeUsd: number | null;
      let floorStrikeUsd: number | null = null;
      let capStrikeUsd: number | null = null;

      if (parsed && "range" in parsed) {
        marketType = "RANGE";
        floorStrikeUsd = parsed.range[0];
        capStrikeUsd = parsed.range[1];
        strikeUsd = (floorStrikeUsd + capStrikeUsd) / 2;
      } else if (parsed && "strike" in parsed) {
        marketType = "UP_DOWN";
        strikeUsd = parsed.strike;
      } else {
        marketType = toMarketType(m.question ?? "");
        strikeUsd = null;
      }

      let priceToBeatUsd: number | null = null;
      if (marketType === "UP_DOWN" && m.eventStartTime) {
        priceToBeatUsd = await fetchPriceToBeatUsd(m.eventStartTime, signal);
      }

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
          description: isCleanOutcomeLabel(m.description) ? m.description!.trim() : null,
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
          priceToBeatUsd,
          expiryMs,
          marketType,
          url: eventUrl,
          rawJson: JSON.stringify({ event: e, market: m }),
          fetchedAt: now,
        });
      }
    }
  }

  return out;
}

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

export interface PolymarketGroup {
  key: string;
  externalEventId: string | null;
  externalId: string;
  question: string;
  expiryMs: number;
  upDown: {
    strikeUsd: number;
    impliedProbUp: number;
    description: string | null;
    priceToBeatUsd: number | null;
  }[];
  range: {
    floorStrikeUsd: number;
    capStrikeUsd: number;
    rangeBandPct: number;
    impliedProbUp: number;
    description: string | null;
  }[];
}

/**
 * Group raw Polymarket BinaryMarket rows into render-ready PolymarketGroup
 * objects. Drops OTHER markets, dedupes YES/UP rows (NO/DOWN are the
 * complement and would double-count), and drops near-certain rows
 * (impliedProb outside 2%–98%) to remove the 99/1 / 100/0 noise.
 * UP_DOWN and RANGE markets for the same event+expiry share a group.
 *
 * Sort order: earliest expiry first.
 */
export function groupPolymarketMarkets(rows: BinaryMarket[]): PolymarketGroup[] {
  const byKey = new Map<string, PolymarketGroup>();
  for (const m of rows) {
    if (m.marketType !== "UP_DOWN" && m.marketType !== "RANGE") continue;
    const isYes = m.outcome === "YES" || m.outcome === "UP";
    const isNo = m.outcome === "NO" || m.outcome === "DOWN";
    if (!isYes && !isNo) continue;
    // Compute the YES-equivalent prob BEFORE applying the
    // near-certain filter. For NO/DOWN rows m.impliedProb is the NO
    // cost, so a near-zero NO cost means a near-certain YES outcome
    // — exactly the case we want to keep. The filter must operate
    // on the YES prob, not the raw value.
    const yesProb = isYes ? m.impliedProb : 1 - m.impliedProb;
    if (yesProb < MIN_IMPLIED_PROB || yesProb > MAX_IMPLIED_PROB) continue;
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
      // Polymarket "Up or Down" intraday markets (e.g. "Bitcoin Up
      // or Down - June 18, 1:00PM-1:05PM ET") have no `groupItemTitle`
      // so the fetcher leaves `strikeUsd = 0` and the YES/NO contract
      // is settled against the candle open. The implicit strike IS
      // the candle open — `priceToBeatUsd`. Without this substitution
      // the markets get filtered out of any strike-based comparison
      // (modal table, range matching) and the Polymarket column reads
      // all "—" even though Polymarket has 90%+ of the active strikes.
      let strike = m.strikeUsd ?? 0;
      if (strike <= 0 && m.priceToBeatUsd && m.priceToBeatUsd > 0) {
        strike = m.priceToBeatUsd;
      }
      // Prefer the YES row if both YES and NO exist for the same
      // strike (they're complements, so picking either gives the same
      // number up to spread — pick YES as the source of truth).
      const existing = group.upDown.find((u) => u.strikeUsd === strike);
      if (!existing) {
        group.upDown.push({
          strikeUsd: strike,
          impliedProbUp: yesProb,
          description: m.description ?? null,
          priceToBeatUsd: m.priceToBeatUsd ?? null,
        });
      }
    } else {
      const floor = m.floorStrikeUsd ?? 0;
      const cap = m.capStrikeUsd ?? 0;
      const existing = group.range.find(
        (r) => r.floorStrikeUsd === floor && r.capStrikeUsd === cap,
      );
      if (!existing) {
        group.range.push({
          floorStrikeUsd: floor,
          capStrikeUsd: cap,
          rangeBandPct: polymarketRangeBandPct(m),
          impliedProbUp: yesProb,
          description: m.description ?? null,
        });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.expiryMs - b.expiryMs);
}
