/**
 * Kalshi Trade API v2 fetcher. Public REST, no authentication required for
 * market-data endpoints. The Lambda polls every 15 minutes; the frontend
 * reads from Amplify Data.
 *
 * Endpoints used:
 *   GET /markets?series_ticker=KXBTC&status=open
 *   GET /events/{event_ticker}    (for category metadata)
 *
 * Ticker encoding: KXBTC-24DEC31-B100000  →  series - YYMMDD - B<strike>
 * The strike is encoded as a fixed-point integer in dollars; the date portion
 * tells us the expiry. We parse both with a regex.
 */

import type { BinaryMarket, Category, MarketType, Outcome } from "./types";

const BASE = "https://external-api.kalshi.com/trade-api/v2";
const SERIES_TICKER = "KXBTC"; // TODO: confirm via /series list if the call returns 404

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
  volume?: number;
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

function toMarketType(title: string, market: RawKalshiMarket): MarketType {
  const lc = title.toLowerCase();
  if (market.strike_type === "between" || lc.includes("between")) return "RANGE";
  if (lc.includes("above") || lc.includes("below") || lc.includes(">") || lc.includes("<")) return "UP_DOWN";
  return "OTHER";
}

function toOutcome(side: "YES" | "NO"): Outcome {
  return side;
}

/**
 * Parse a Kalshi ticker like "KXBTC-24DEC31-B100000" into its components.
 * Returns null for non-BTC tickers or unparseable shapes.
 */
interface ParsedTicker {
  strikeUsd: number | null;
  expiryMs: number | null;
}
function parseTicker(ticker: string): ParsedTicker {
  // Format: <series>-<YYMMDD>-<T><strike>
  // e.g.   KXBTC-24DEC31-B100000  →  strike=100000, expiry=2024-12-31
  const match = ticker.match(/^[A-Z0-9]+-(\d{2})([A-Z]{3})(\d{2})-(?:B|T|R)(\d+(?:\.\d+)?)/i);
  if (!match) return { strikeUsd: null, expiryMs: null };
  const [, yy, monStr, dd, strikeStr] = match;
  const monthIdx = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].indexOf(
    monStr.toUpperCase(),
  );
  if (monthIdx < 0) return { strikeUsd: null, expiryMs: null };
  const year = 2000 + Number(yy);
  const day = Number(dd);
  const expiryDate = new Date(Date.UTC(year, monthIdx, day, 23, 59, 59));
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
 * Fetch open KXBTC markets from Kalshi. Each binary market is split into
 * YES and NO BinaryMarket rows so the search table can compare odds on
 * equal footing with Polymarket.
 */
export async function fetchKalshiMarkets(
  signal?: AbortSignal,
): Promise<BinaryMarket[]> {
  console.log(`[kalshi] GET /markets?series_ticker=${SERIES_TICKER}&status=open&limit=200`);
  const data = await fetchJSON<RawMarketsResponse>(
    `${BASE}/markets?series_ticker=${SERIES_TICKER}&status=open&limit=200`,
    signal,
  );
  console.log(`[kalshi] received ${data.markets.length} markets for series ${SERIES_TICKER}`);

  const now = new Date().toISOString();
  const out: BinaryMarket[] = [];
  let skipped = 0;
  let eventFetchFails = 0;

  for (const m of data.markets) {
    // Skip settled/closed.
    if (m.status && m.status !== "open" && m.status !== "active") {
      skipped += 1;
      continue;
    }

    const category = toCategory(m.category);
    const subcategory = toSubcategory(category, m.title);
    const marketType = toMarketType(m.title, m);
    const parsed = parseTicker(m.ticker);
    const expiryMs =
      parsed.expiryMs ?? toExpiryMs(m.close_time, m.expected_expiration_time);
    const strikeUsd =
      parsed.strikeUsd ?? toNumber(m.floor_strike) ?? toNumber(m.cap_strike) ?? null;
    const url = m.series_ticker
      ? `https://kalshi.com/markets/${m.series_ticker.toLowerCase()}`
      : `https://kalshi.com/markets/${m.ticker.toLowerCase()}`;

    let eventMeta: RawKalshiEvent["event"] | null = null;
    try {
      const ev = await fetchJSON<RawKalshiEvent>(
        `${BASE}/events/${encodeURIComponent(m.event_ticker)}`,
        signal,
      );
      eventMeta = ev.event;
    } catch {
      eventFetchFails += 1;
      // Non-fatal: we still have the market row.
    }

    const finalCategory = eventMeta ? toCategory(eventMeta.category) : category;
    const finalSubcategory = eventMeta
      ? toSubcategory(finalCategory, eventMeta.title)
      : subcategory;

    // YES row: best price is mid of yes_bid / yes_ask when both present;
    // fall back to whichever field is populated.
    const yesBid = toNumber(m.yes_bid_dollars);
    const yesAsk = toNumber(m.yes_ask_dollars);
    const noBid = toNumber(m.no_bid_dollars);
    const noAsk = toNumber(m.no_ask_dollars);
    const volume24hUsd = toNumber(m.volume) ?? toNumber(m.volume_fp);

    if (yesBid !== null || yesAsk !== null) {
      const implied = yesAsk !== null ? yesAsk : yesBid ?? 0.5;
      out.push({
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
        strikeUsd,
        expiryMs,
        marketType,
        url,
        rawJson: JSON.stringify({ market: m, event: eventMeta }),
        fetchedAt: now,
      });
    }

    if (noBid !== null || noAsk !== null) {
      const implied = noAsk !== null ? noAsk : noBid ?? 0.5;
      out.push({
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
        strikeUsd,
        expiryMs,
        marketType,
        url,
        rawJson: JSON.stringify({ market: m, event: eventMeta }),
        fetchedAt: now,
      });
    }
  }

  console.log(
    `[kalshi] summary: ${data.markets.length} received, ${skipped} skipped (closed), ` +
    `${eventFetchFails} event-meta fetch failures, ${out.length} outcome rows written`,
  );
  if (out.length > 0) {
    console.log(`[kalshi] first row sample:`, JSON.stringify({
      platform: out[0].platform,
      question: out[0].question.slice(0, 60),
      outcome: out[0].outcome,
      impliedProb: out[0].impliedProb,
      strikeUsd: out[0].strikeUsd,
      expiryMs: out[0].expiryMs,
    }));
  }

  return out;
}
