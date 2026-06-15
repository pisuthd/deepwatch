/**
 * Polymarket Gamma API fetcher. Public REST, no authentication.
 *
 * The Lambda runs this on a 15-minute schedule and writes one BinaryMarket
 * row per (market, outcome). Outcomes and prices come back as
 * double-encoded JSON strings, e.g. `"[\"Yes\", \"No\"]"` and
 * `"[\"0.20\", \"0.80\"]"` — they must be JSON.parse'd twice.
 */

import type { BinaryMarket, Category, MarketType, Outcome } from "./types";

const BASE = "https://gamma-api.polymarket.com";

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
}

interface RawMarket {
  id: string;
  slug: string;
  question: string;
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
  startDate?: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  enableOrderBook?: boolean;
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
  if (lc.includes("between") || lc.includes("range") || lc.includes("$") && lc.includes("-")) return "RANGE";
  if (lc.includes("up or down") || lc.includes("above") || lc.includes("below") || lc.includes(">") || lc.includes("<")) return "UP_DOWN";
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
 * Pull active crypto markets from Polymarket. Returns one BinaryMarket row
 * per (market, outcome) — for binary markets that's 2 rows, for multi-outcome
 * markets up to N rows.
 */
export async function fetchPolymarketMarkets(
  signal?: AbortSignal,
): Promise<BinaryMarket[]> {
  // Strategy: list all active events, filter to crypto-tagged ones, expand
  // each event's markets into per-outcome rows. The Gamma `/events` endpoint
  // returns nested markets so this is a single round-trip.
  console.log(`[polymarket] GET /events?active=true&closed=false&order=volume_24hr&limit=200`);
  const events = await fetchJSON<RawEvent[]>(
    `${BASE}/events?active=true&closed=false&order=volume_24hr&ascending=false&limit=200`,
    signal,
  );
  console.log(`[polymarket] received ${events.length} events`);

  const now = new Date().toISOString();
  const out: BinaryMarket[] = [];
  let cryptoEventCount = 0;
  let totalMarketCount = 0;
  let skippedMarketCount = 0;

  for (const ev of events) {
    const markets = ev.markets ?? [];
    if (markets.length === 0) continue;
    const eventCategory = toCategory(ev.category, ev.tags);
    if (eventCategory !== "CRYPTO") continue;       // Phase 1 = crypto only
    cryptoEventCount += 1;
    const eventSubcategory = toSubcategory(eventCategory, ev.title ?? "", ev.tags);
    console.log(`[polymarket] crypto event: "${ev.title}" → ${markets.length} markets, subcategory=${eventSubcategory}`);

    for (const m of markets) {
      totalMarketCount += 1;
      if (m.closed || m.active === false) {
        skippedMarketCount += 1;
        continue;
      }
      const outcomes = decodeJsonArray<string>(m.outcomes);
      const prices = decodeJsonArray<string>(m.outcomePrices);
      if (outcomes.length === 0 || outcomes.length !== prices.length) {
        skippedMarketCount += 1;
        continue;
      }

      const url = `https://polymarket.com/event/${ev.slug}`;
      const bestBid = toNumber(m.bestBid);
      const bestAsk = toNumber(m.bestAsk);
      const volume24hUsd = toNumber(m.volume24hr ?? m.volume);
      const expiryMs = toExpiryMs(m.endDate ?? ev.endDate);
      const marketType = toMarketType(m.question ?? ev.title ?? "");

      for (let i = 0; i < outcomes.length; i++) {
        const prob = Number(prices[i]);
        if (!Number.isFinite(prob)) continue;
        out.push({
          platform: "POLYMARKET",
          externalId: m.slug || m.id,
          externalEventId: ev.id ?? ev.slug,
          question: m.question ?? ev.title ?? "",
          description: m.description ?? ev.description ?? null,
          category: eventCategory,
          subcategory: eventSubcategory,
          outcome: toOutcome(outcomes[i]),
          impliedProb: Math.max(0, Math.min(1, prob)),
          bestBidUsd: bestBid,
          bestAskUsd: bestAsk,
          volume24hUsd,
          strikeUsd: null,
          expiryMs,
          marketType,
          url,
          rawJson: JSON.stringify({ event: ev, market: m }),
          fetchedAt: now,
        });
      }
    }
  }

  console.log(
    `[polymarket] summary: ${cryptoEventCount}/${events.length} crypto events, ` +
    `${totalMarketCount} markets seen, ${skippedMarketCount} skipped, ` +
    `${out.length} outcome rows written`,
  );

  if (out.length > 0) {
    console.log(`[polymarket] first row sample:`, JSON.stringify({
      platform: out[0].platform,
      question: out[0].question.slice(0, 60),
      outcome: out[0].outcome,
      impliedProb: out[0].impliedProb,
      volume24hUsd: out[0].volume24hUsd,
    }));
  }

  return out;
}
