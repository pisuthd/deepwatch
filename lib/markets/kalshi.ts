/**
 * Kalshi Trade API v2 fetcher. Public REST, no authentication required for
 * market-data endpoints. The Lambda polls every 15 minutes; the frontend
 * reads from Amplify Data.
 *
 * Endpoints used:
 *   GET /markets?series_ticker={SERIES}&status=open     (paginated via cursor)
 *   GET /events/{event_ticker}                         (for category metadata)
 *
 * BTC series — Kalshi splits Bitcoin into two complementary series per
 * expiry, both needed to capture the full surface:
 *
 *   KXBTC  — the "bucket" partition. 1 "less than" tail + N "between"
 *            buckets (e.g. $66,600–66,699.99) + 1 "greater than" tail.
 *            Implied probs across the chain should sum to ~1.0.
 *            market_type → RANGE for buckets, UP_DOWN for the two tails.
 *
 *   KXBTCD — the "up/down" series. N binary "is BTC above $X?" markets,
 *            one per strike. market_type → UP_DOWN for all of them.
 *
 * If Kalshi adds a third BTC series, add it to BTC_SERIES below.
 *
 * Ticker encoding: KXBTC-26JUN1512-B66650  →  series - YYMMDDHH - B<strike>
 * The B/T prefix encodes the strike_type: B=between (RANGE), T=threshold
 * (greater or less — disambiguated by the strike_type field, not the prefix).
 */

import type { BinaryMarket, Category, MarketType, Outcome } from "./types";
import { binaryMarketId } from "./id";

const BASE = "https://external-api.kalshi.com/trade-api/v2";
const BTC_SERIES = ["KXBTC", "KXBTCD"] as const;

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
  /** Total volume over the market's lifetime (contracts). */
  volume_fp?: string;
  /** 24h volume (contracts) — the field the search UI should use. */
  volume_24h_fp?: string;
  open_interest_fp?: string;
  open_time?: string;
  close_time?: string;
  expected_expiration_time?: string;
  status: string;
  /** "between" | "greater" | "less" — the source of truth for market type. */
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
 * Derive marketType from the structured `strike_type` field. The title
 * text is unreliable — KXBTC and KXBTCD markets have nearly identical
 * titles ("Bitcoin price range on …" / "Bitcoin price on …") that don't
 * carry the strike semantics. The structured field is the source of truth.
 */
function toMarketType(market: RawKalshiMarket): MarketType {
  switch (market.strike_type) {
    case "between":  return "RANGE";
    case "greater":  return "UP_DOWN";
    case "less":     return "UP_DOWN";
    default:         return "OTHER";
  }
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
 * The date portion is YYMMDDHH (year/month/day/hour in UTC); the strike
 * is encoded as a fixed-point dollar amount after the B/T/R prefix.
 *
 * For `between` markets, the ticker strike is the MIDPOINT of the
 * [floor_strike, cap_strike] range. For `greater`/`less` markets, the
 * ticker strike is the threshold. Either way it's a usable number.
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

/**
 * Resolve strike + range bounds from the structured fields. Returns:
 *   - strikeUsd: representative single number (the strike for UP_DOWN,
 *                the band midpoint for RANGE)
 *   - floorStrikeUsd / capStrikeUsd: the actual range bounds, or null
 *     for the unbounded tail of UP_DOWN markets
 */
function resolveStrike(market: RawKalshiMarket): {
  strikeUsd: number | null;
  floorStrikeUsd: number | null;
  capStrikeUsd: number | null;
} {
  const floor = toNumber(market.floor_strike);
  const cap = toNumber(market.cap_strike);
  switch (market.strike_type) {
    case "between":
      // Both bounds set. strikeUsd = midpoint for sort/display.
      if (floor !== null && cap !== null) {
        return {
          strikeUsd: (floor + cap) / 2,
          floorStrikeUsd: floor,
          capStrikeUsd: cap,
        };
      }
      // Fallback if one bound is missing.
      return { strikeUsd: floor ?? cap, floorStrikeUsd: floor, capStrikeUsd: cap };
    case "greater":
      // floor_strike is the threshold; cap is +∞.
      return { strikeUsd: floor, floorStrikeUsd: floor, capStrikeUsd: null };
    case "less":
      // cap_strike is the threshold; floor is −∞.
      return { strikeUsd: cap, floorStrikeUsd: null, capStrikeUsd: cap };
    default:
      return { strikeUsd: floor ?? cap, floorStrikeUsd: floor, capStrikeUsd: cap };
  }
}

/**
 * Page through all open markets for one series. Returns a flat list.
 */
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

/**
 * Batch-fetch event metadata for a unique set of event_tickers. Replaces
 * the previous N+1 sequential fetches (one per market) with one round
 * trip per unique event.
 */
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

/**
 * Fetch open BTC markets from BOTH Kalshi series (KXBTC + KXBTCD) and
 * write one BinaryMarket row per (market, outcome) — 2 rows per binary
 * market. Range bounds come from floor_strike/cap_strike; strikeUsd is
 * the band midpoint for RANGE rows and the threshold for UP_DOWN rows.
 */
export async function fetchKalshiMarkets(
  signal?: AbortSignal,
): Promise<BinaryMarket[]> {
  // Step 1: fetch both series in parallel.
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

  // Step 2: batch event-metadata fetch (one per unique event_ticker
  // instead of one per market — N+1 → 1+1).
  const uniqueEventTickers = [...new Set(allMarkets.map((m) => m.event_ticker))];
  const eventMetaMap = await fetchEventMetaBatch(uniqueEventTickers, signal);
  console.log(`[kalshi] event-meta: ${eventMetaMap.size}/${uniqueEventTickers.length} resolved`);

  // Step 3: emit rows.
  const now = new Date().toISOString();
  const out: BinaryMarket[] = [];
  let skipped = 0;
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
    const { strikeUsd, floorStrikeUsd, capStrikeUsd } = resolveStrike(m);
    // Fall back to ticker-parsed strike if structured fields are empty
    // (shouldn't happen for KXBTC/KXBTCD but defensive).
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
    // 24h volume (contracts) is the right field for the search UI.
    // volume_fp is lifetime, volume_24h_fp is 24h.
    const volume24hUsd = toNumber(m.volume_24h_fp) ?? toNumber(m.volume_fp) ?? null;

    if (yesBid !== null || yesAsk !== null) {
      const implied = yesAsk !== null ? yesAsk : yesBid ?? 0.5;
      out.push({
        id: binaryMarketId("KALSHI", m.ticker, "YES"),
        platform: "KALSHI",
        externalId: m.ticker,
        externalEventId: m.event_ticker,
        question: m.title,
        description: m.subtitle ?? null,
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
        description: m.subtitle ?? null,
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
    `${skipped} skipped (closed), ${out.length} outcome rows written ` +
    `(up/down=${typeCounts.UP_DOWN}, range=${typeCounts.RANGE}, other=${typeCounts.OTHER})`,
  );

  if (out.length > 0) {
    console.log(`[kalshi] first row sample:`, JSON.stringify({
      platform: out[0].platform,
      question: out[0].question.slice(0, 60),
      outcome: out[0].outcome,
      impliedProb: out[0].impliedProb,
      marketType: out[0].marketType,
      strikeUsd: out[0].strikeUsd,
      floorStrikeUsd: out[0].floorStrikeUsd,
      capStrikeUsd: out[0].capStrikeUsd,
      volume24hUsd: out[0].volume24hUsd,
      expiryMs: out[0].expiryMs,
    }));
  }

  return out;
}
