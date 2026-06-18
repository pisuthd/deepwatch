/**
 * Kalshi Trade API v2 fetcher. Public REST, no authentication required for
 * market-data endpoints.
 *
 * Endpoints used:
 *   GET /markets?series_ticker={SERIES}&status=open     (paginated via cursor)
 *   GET /events/{event_ticker}                         (for category metadata)
 *
 * BTC series — Kalshi splits Bitcoin into two complementary series per
 * expiry, both needed to capture the full surface:
 *
 *   KXBTC  — the "bucket" partition. 1 "less than" tail + N "between"
 *            buckets + 1 "greater than" tail. UP_DOWN for the two
 *            tails, RANGE for the buckets.
 *
 *   KXBTCD — the "up/down" series. N binary "is BTC above $X?" markets,
 *            one per strike. UP_DOWN for all of them.
 *
 * Ticker encoding: KXBTC-26JUN1512-B66650  →  series - YYMMDDHH - B<strike>
 * The B/T prefix encodes the strike_type: B=between (RANGE), T=threshold
 * (greater or less — disambiguated by the strike_type field, not the prefix).
 */

import type { BinaryMarket, Category, MarketType, Outcome } from "./types";
import { binaryMarketId } from "./id"

const BASE = "https://external-api.kalshi.com/trade-api/v2";
const BTC_SERIES = ["KXBTC", "KXBTCD"] as const;

/**
 * Frontend view-time filter for near-certain markets. The grouping
 * function below drops any YES/UP row whose implied probability is
 * outside this band. 2%–98% mirrors polymarket.ts.
 */
const MIN_IMPLIED_PROB = 0.02;
const MAX_IMPLIED_PROB = 0.98;

interface RawKalshiMarket {
  ticker: string;
  event_ticker: string;
  series_ticker: string;
  title: string;
  subtitle?: string;
  category?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  volume_fp?: string;
  volume_24h_fp?: string;
  open_interest_fp?: string;
  open_time?: string;
  close_time?: string;
  expected_expiration_time?: string;
  status: string;
  strike_type?: string;
  floor_strike?: number;
  cap_strike?: number;
}

interface RawKalshiEvent {
  event: {
    ticker: string;
    series_ticker: string;
    title: string;
    category: string;
    mutually_exclusive?: boolean;
  };
}

interface RawMarketsResponse {
  markets: RawKalshiMarket[];
  cursor?: string;
}

async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const t = Date.now();
  const res = await fetch(url, { signal });
  if (!res.ok) {
    console.warn(`[kalshi] HTTP ${res.status} for ${url} in ${Date.now() - t}ms`);
    throw new Error(`Kalshi HTTP ${res.status} for ${url}`);
  }
  const data = (await res.json()) as T;
  console.log(`[kalshi] HTTP ${res.status} for ${url} in ${Date.now() - t}ms`);
  return data;
}

function toNumber(x: string | number | undefined | null): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function toCategory(raw: string | undefined): Category {
  const lc = (raw ?? "").toLowerCase();
  if (lc.includes("crypto") || lc.includes("bitcoin") || lc.includes("btc")) return "CRYPTO";
  if (lc.includes("politic") || lc.includes("election")) return "POLITICS";
  if (lc.includes("sport")) return "SPORTS";
  return "OTHER";
}

function toSubcategory(category: Category, title: string): string | null {
  if (category === "CRYPTO") {
    const lc = title.toLowerCase();
    if (lc.includes("bitcoin") || lc.includes("btc")) return "Bitcoin";
    if (lc.includes("ethereum") || lc.includes("eth")) return "Ethereum";
    if (lc.includes("solana") || lc.includes("sol")) return "Solana";
    return "Crypto";
  }
  return null;
}

/**
 * Derive marketType from the structured fields:
 *   - floor_strike / cap_strike presence: both set → RANGE; exactly one
 *     set → UP_DOWN.
 *   - series_ticker: KXBTCD markets have neither floor nor cap, so we
 *     fall back to the series name to classify the "is BTC above $X?"
 *     binary series as UP_DOWN.
 */
function toMarketType(market: RawKalshiMarket): MarketType {
  const floor = toNumber(market.floor_strike);
  const cap = toNumber(market.cap_strike);
  if (floor !== null && cap !== null) return "RANGE";
  if (floor !== null || cap !== null) return "UP_DOWN";
  if (market.series_ticker === "KXBTCD") return "UP_DOWN";
  return "OTHER";
}

function toOutcome(side: "YES" | "NO"): Outcome {
  return side;
}

interface ParsedTicker {
  strikeUsd: number | null;
  expiryMs: number | null;
}

/**
 * Parse a Kalshi ticker like "KXBTC-26JUN1512-B66650" into its components.
 */
function parseTicker(ticker: string): ParsedTicker {
  const match = ticker.match(
    /^[A-Z0-9]+-(\d{2})([A-Z]{3})(\d{4})-(?:B|T|R)(\d+(?:\.\d+)?)/i,
  );
  if (!match) return { strikeUsd: null, expiryMs: null };
  const [, yy, monStr, ddhh, strikeStr] = match;
  const monthIdx = [
    "JAN","FEB","MAR","APR","MAY","JUN",
    "JUL","AUG","SEP","OCT","NOV","DEC",
  ].indexOf(monStr.toUpperCase());
  if (monthIdx < 0) return { strikeUsd: null, expiryMs: null };
  const year = 2000 + Number(yy);
  const day = Number(ddhh.slice(0, 2));
  const hour = Number(ddhh.slice(2, 4));
  const expiryDate = new Date(Date.UTC(year, monthIdx, day, hour, 59, 59));
  const expiryMs = expiryDate.getTime();
  const strikeUsd = toNumber(strikeStr);
  return { strikeUsd, expiryMs };
}

function toExpiryMs(...candidates: Array<string | undefined>): number | null {
  for (const c of candidates) {
    if (!c) continue;
    const ms = new Date(c).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function resolveStrike(market: RawKalshiMarket): {
  strikeUsd: number | null;
  floorStrikeUsd: number | null;
  capStrikeUsd: number | null;
} {
  const floor = toNumber(market.floor_strike);
  const cap = toNumber(market.cap_strike);
  switch (market.strike_type) {
    case "between":
      if (floor !== null && cap !== null) {
        return {
          strikeUsd: (floor + cap) / 2,
          floorStrikeUsd: floor,
          capStrikeUsd: cap,
        };
      }
      return { strikeUsd: floor ?? cap, floorStrikeUsd: floor, capStrikeUsd: cap };
    case "greater":
      return { strikeUsd: floor, floorStrikeUsd: floor, capStrikeUsd: null };
    case "less":
      return { strikeUsd: cap, floorStrikeUsd: null, capStrikeUsd: cap };
    default:
      return { strikeUsd: floor ?? cap, floorStrikeUsd: floor, capStrikeUsd: cap };
  }
}

async function fetchSeriesMarkets(
  seriesTicker: string,
  signal?: AbortSignal,
): Promise<RawKalshiMarket[]> {
  const out: RawKalshiMarket[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const url = new URL(`${BASE}/markets`);
    url.searchParams.set("series_ticker", seriesTicker);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await fetchJSON<RawMarketsResponse>(url.toString(), signal);
    pages += 1;
    out.push(...data.markets);
    cursor = data.cursor || undefined;
    if (pages > 20) {
      console.warn(`[kalshi] ${seriesTicker}: safety stop at 20 pages`);
      break;
    }
  } while (cursor);
  return out;
}

async function fetchEventMetaBatch(
  eventTickers: string[],
  signal?: AbortSignal,
): Promise<Map<string, RawKalshiEvent["event"]>> {
  const out = new Map<string, RawKalshiEvent["event"]>();
  const results = await Promise.allSettled(
    eventTickers.map(async (ticker) => {
      const r = await fetchJSON<RawKalshiEvent>(
        `${BASE}/events/${encodeURIComponent(ticker)}`,
        signal,
      );
      return [ticker, r.event] as const;
    }),
  );
  let fails = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      out.set(r.value[0], r.value[1]);
    } else {
      fails += 1;
    }
  }
  if (fails > 0) {
    console.warn(`[kalshi] event-meta batch: ${fails}/${eventTickers.length} failed`);
  }
  return out;
}

export async function fetchKalshiMarkets(
  signal?: AbortSignal,
): Promise<BinaryMarket[]> {
  const seriesResults = await Promise.allSettled(
    BTC_SERIES.map((s) => fetchSeriesMarkets(s, signal)),
  );
  const allMarkets: RawKalshiMarket[] = [];
  const seriesStats: Record<string, number> = {};
  for (let i = 0; i < BTC_SERIES.length; i += 1) {
    const r = seriesResults[i];
    const series = BTC_SERIES[i];
    if (r.status === "fulfilled") {
      allMarkets.push(...r.value);
      seriesStats[series] = r.value.length;
    } else {
      console.warn(`[kalshi] ${series}: fetch failed — ${r.reason}`);
      seriesStats[series] = 0;
    }
  }
  console.log(`[kalshi] received ${allMarkets.length} markets across series: ${
    BTC_SERIES.map((s) => `${s}=${seriesStats[s]}`).join(", ")
  }`);

  const uniqueEventTickers = [...new Set(allMarkets.map((m) => m.event_ticker))];
  const eventMetaMap = await fetchEventMetaBatch(uniqueEventTickers, signal);
  console.log(`[kalshi] event-meta: ${eventMetaMap.size}/${uniqueEventTickers.length} resolved`);

  const now = new Date().toISOString();
  const EXPIRY_BUFFER_MS = 60_000;
  const nowMs = Date.now();
  const out: BinaryMarket[] = [];
  let skipped = 0;
  let expiredSkipped = 0;
  const typeCounts = { UP_DOWN: 0, RANGE: 0, OTHER: 0 };
  const bumpTypeCount = (t: MarketType): void => {
    typeCounts[t] += 1;
  };

  for (const m of allMarkets) {
    if (m.status && m.status !== "open" && m.status !== "active") {
      skipped += 1;
      continue;
    }

    const marketType = toMarketType(m);
    const parsed = parseTicker(m.ticker);
    const expiryMs =
      parsed.expiryMs ?? toExpiryMs(m.close_time, m.expected_expiration_time);
    if (expiryMs !== null && expiryMs <= nowMs + EXPIRY_BUFFER_MS) {
      expiredSkipped += 1;
      continue;
    }
    const { strikeUsd, floorStrikeUsd, capStrikeUsd } = resolveStrike(m);
    const finalStrike = strikeUsd ?? parsed.strikeUsd ?? null;

    const eventMeta = eventMetaMap.get(m.event_ticker) ?? null;
    const fallbackCategory = toCategory(m.category);
    const finalCategory = eventMeta ? toCategory(eventMeta.category) : fallbackCategory;
    const finalSubcategory = eventMeta
      ? toSubcategory(finalCategory, eventMeta.title)
      : toSubcategory(finalCategory, m.title);

    const url = m.series_ticker
      ? `https://kalshi.com/markets/${m.series_ticker.toLowerCase()}/${m.event_ticker.toLowerCase()}`
      : `https://kalshi.com/markets/${m.ticker.toLowerCase()}`;

    const yesBid = toNumber(m.yes_bid_dollars);
    const yesAsk = toNumber(m.yes_ask_dollars);
    const noBid = toNumber(m.no_bid_dollars);
    const noAsk = toNumber(m.no_ask_dollars);
    const volume24hUsd = toNumber(m.volume_24h_fp) ?? toNumber(m.volume_fp) ?? null;

    const description = m.subtitle ?? null;
    const priceToBeatUsd: number | null = null;

    if (yesBid !== null || yesAsk !== null) {
      const implied = yesAsk !== null ? yesAsk : yesBid ?? 0.5;
      out.push({
        id: binaryMarketId("KALSHI", m.ticker, "YES"),
        platform: "KALSHI",
        externalId: m.ticker,
        externalEventId: m.event_ticker,
        question: m.title,
        description,
        category: finalCategory,
        subcategory: finalSubcategory,
        outcome: toOutcome("YES"),
        impliedProb: Math.max(0, Math.min(1, implied)),
        bestBidUsd: yesBid,
        bestAskUsd: yesAsk,
        volume24hUsd,
        strikeUsd: finalStrike,
        floorStrikeUsd,
        capStrikeUsd,
        priceToBeatUsd,
        expiryMs,
        marketType,
        url,
        rawJson: JSON.stringify({ market: m, event: eventMeta }),
        fetchedAt: now,
      });
      bumpTypeCount(marketType);
    }

    if (noBid !== null || noAsk !== null) {
      const implied = noAsk !== null ? noAsk : noBid ?? 0.5;
      out.push({
        id: binaryMarketId("KALSHI", m.ticker, "NO"),
        platform: "KALSHI",
        externalId: m.ticker,
        externalEventId: m.event_ticker,
        question: m.title,
        description,
        category: finalCategory,
        subcategory: finalSubcategory,
        outcome: toOutcome("NO"),
        impliedProb: Math.max(0, Math.min(1, implied)),
        bestBidUsd: noBid,
        bestAskUsd: noAsk,
        volume24hUsd,
        strikeUsd: finalStrike,
        floorStrikeUsd,
        capStrikeUsd,
        priceToBeatUsd,
        expiryMs,
        marketType,
        url,
        rawJson: JSON.stringify({ market: m, event: eventMeta }),
        fetchedAt: now,
      });
      bumpTypeCount(marketType);
    }
  }

  console.log(
    `[kalshi] summary: ${allMarkets.length} received across ${BTC_SERIES.length} series, ` +
    `${skipped} skipped (closed), ${expiredSkipped} expired-skipped (<= ${EXPIRY_BUFFER_MS / 1000}s), ` +
    `${out.length} outcome rows written ` +
    `(up/down=${typeCounts.UP_DOWN}, range=${typeCounts.RANGE}, other=${typeCounts.OTHER})`,
  );

  return out;
}

export function kalshiRangeBandPct(m: BinaryMarket): number {
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

export interface KalshiGroup {
  /** `${expiryMs}` */
  key: string;
  externalEventId: string | null;
  externalId: string;
  question: string;
  expiryMs: number;
  upDown: {
    strikeUsd: number;
    impliedProbUp: number;
    description: string | null;
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
 * Group raw Kalshi BinaryMarket rows into render-ready KalshiGroup
 * objects. Drops OTHER (single YES/NO) markets, dedupes YES/UP rows,
 * and drops near-certain rows. UP_DOWN and RANGE markets for the same
 * expiry share a group.
 *
 * Sort order: earliest expiry first.
 */
export function groupKalshiMarkets(rows: BinaryMarket[]): KalshiGroup[] {
  const byKey = new Map<string, KalshiGroup>();
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
    const key = `${expiry}`;
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
      const strike = m.strikeUsd ?? 0;
      const existing = group.upDown.find((u) => u.strikeUsd === strike);
      if (!existing) {
        group.upDown.push({
          strikeUsd: strike,
          impliedProbUp: yesProb,
          description: m.description ?? null,
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
          rangeBandPct: kalshiRangeBandPct(m),
          impliedProbUp: yesProb,
          description: m.description ?? null,
        });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.expiryMs - b.expiryMs);
}
