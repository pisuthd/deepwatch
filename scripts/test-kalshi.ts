/**
 * Smoke-test the Kalshi Trade API v2 fetcher from your local machine.
 * Mirrors what the production fetcher (lib/markets/kalshi.ts) does:
 *   - poll BOTH KXBTC and KXBTCD series (paginated)
 *   - batch the event-metadata fetch
 *   - classify each market by strike_type (between → RANGE, greater/less → UP_DOWN)
 *   - resolve strikeUsd (midpoint for ranges, threshold for up/down)
 *   - populate floorStrikeUsd / capStrikeUsd from floor_strike / cap_strike
 *   - use volume_24h_fp (NOT volume_fp, which is lifetime)
 *
 *   npx tsx scripts/test-kalshi.ts
 *
 * Exits non-zero if either series is empty, if RANGE rows are missing
 * bounds, or if any row uses lifetime volume instead of 24h.
 */

const BASE = "https://external-api.kalshi.com/trade-api/v2";
const BTC_SERIES = ["KXBTC", "KXBTCD"] as const;
const TIMEOUT_MS = 30_000;

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
  status: string;
  strike_type?: string;
  floor_strike?: number;
  cap_strike?: number;
}

interface RawMarketsResponse {
  markets: RawKalshiMarket[];
  cursor?: string;
}

async function fetchSeries(series: string, signal: AbortSignal): Promise<RawKalshiMarket[]> {
  const out: RawKalshiMarket[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const url = new URL(`${BASE}/markets`);
    url.searchParams.set("series_ticker", series);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const r = await fetch(url.toString(), { signal, headers: { accept: "application/json" } });
    const t = Date.now();
    if (!r.ok) { console.error(`[kalshi] ${series} HTTP ${r.status}`); break; }
    const data = (await r.json()) as RawMarketsResponse;
    console.log(`[kalshi] ${series} page ${pages + 1}: HTTP ${r.status} in ${Date.now() - t}ms, ${data.markets.length} markets${cursor ? ` (cursor=${cursor.slice(0, 12)}...)` : ""}`);
    out.push(...data.markets);
    cursor = data.cursor || undefined;
    pages += 1;
    if (pages > 20) { console.error(`[kalshi] ${series}: safety stop`); break; }
  } while (cursor);
  return out;
}

function toNumber(x: string | number | undefined | null): number | null {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

type MarketType = "UP_DOWN" | "RANGE" | "OTHER";

function classify(m: RawKalshiMarket): MarketType {
  switch (m.strike_type) {
    case "between":  return "RANGE";
    case "greater":  return "UP_DOWN";
    case "less":     return "UP_DOWN";
    default:         return "OTHER";
  }
}

function resolveStrike(m: RawKalshiMarket): {
  strikeUsd: number | null;
  floorStrikeUsd: number | null;
  capStrikeUsd: number | null;
} {
  const floor = toNumber(m.floor_strike);
  const cap = toNumber(m.cap_strike);
  switch (m.strike_type) {
    case "between":
      if (floor !== null && cap !== null) {
        return { strikeUsd: (floor + cap) / 2, floorStrikeUsd: floor, capStrikeUsd: cap };
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

async function main() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    // Fetch both series in parallel.
    const seriesResults = await Promise.all(
      BTC_SERIES.map((s) => fetchSeries(s, ctrl.signal)),
    );
    const allMarkets: Array<{ series: string; m: RawKalshiMarket }> = [];
    for (let i = 0; i < BTC_SERIES.length; i += 1) {
      const series = BTC_SERIES[i];
      for (const m of seriesResults[i]) {
        allMarkets.push({ series, m });
      }
    }
    console.log(`[kalshi] total markets: ${allMarkets.length} (${Date.now() - t0}ms)`);

    if (allMarkets.length === 0) {
      console.error(`[kalshi] FAIL — no markets returned from any series`);
      process.exit(1);
    }

    // Per-series counts.
    const perSeries: Record<string, number> = {};
    for (const s of BTC_SERIES) perSeries[s] = 0;
    for (const { series, m } of allMarkets) {
      perSeries[series] = (perSeries[series] ?? 0) + 1;
    }
    for (const s of BTC_SERIES) {
      if (perSeries[s] === 0) {
        console.error(`[kalshi] FAIL — series ${s} returned 0 markets`);
        process.exit(1);
      }
    }

    // Walk markets, classify + resolve + accumulate stats.
    const seen = { UP_DOWN: 0, RANGE: 0, OTHER: 0 } as Record<MarketType, number>;
    const perSeriesByType: Record<string, Record<MarketType, number>> = {};
    for (const s of BTC_SERIES) perSeriesByType[s] = { UP_DOWN: 0, RANGE: 0, OTHER: 0 };
    let rangeWithBounds = 0;
    let rangeMissingBounds = 0;
    let upDownWithStrike = 0;
    let usingLifetimeVolume = 0;
    let using24hVolume = 0;
    let missingVolume = 0;

    const samples: Record<MarketType, Array<{
      series: string; question: string; subtitle?: string;
      strikeUsd: number | null; floorStrikeUsd: number | null; capStrikeUsd: number | null;
      volume24hFp: string | undefined; volumeFp: string | undefined;
    }> | null> = { UP_DOWN: null, RANGE: null, OTHER: null };

    for (const { series, m } of allMarkets) {
      if (m.status && m.status !== "open" && m.status !== "active") continue;
      const t = classify(m);
      const r = resolveStrike(m);
      seen[t] += 1;
      perSeriesByType[series][t] += 1;

      if (t === "RANGE") {
        if (r.floorStrikeUsd !== null && r.capStrikeUsd !== null) rangeWithBounds += 1;
        else rangeMissingBounds += 1;
      } else if (t === "UP_DOWN") {
        if (r.strikeUsd !== null) upDownWithStrike += 1;
      }

      if (m.volume_24h_fp != null && m.volume_24h_fp !== "") using24hVolume += 1;
      else if (m.volume_fp != null && m.volume_fp !== "") usingLifetimeVolume += 1;
      else missingVolume += 1;

      if (samples[t] === null) samples[t] = [];
      if (samples[t]!.length < 3) {
        samples[t]!.push({
          series,
          question: (m.title ?? "").slice(0, 60),
          subtitle: m.subtitle?.slice(0, 40),
          strikeUsd: r.strikeUsd,
          floorStrikeUsd: r.floorStrikeUsd,
          capStrikeUsd: r.capStrikeUsd,
          volume24hFp: m.volume_24h_fp,
          volumeFp: m.volume_fp,
        });
      }
    }

    console.log(`\n--- per-series totals ---`);
    for (const s of BTC_SERIES) {
      console.log(`  ${s}: ${perSeries[s]} markets  (up/down=${perSeriesByType[s].UP_DOWN}, range=${perSeriesByType[s].RANGE}, other=${perSeriesByType[s].OTHER})`);
    }

    console.log(`\n--- combined breakdown ---`);
    console.log(`  total markets:        ${allMarkets.length}`);
    console.log(`  up/down:              ${seen.UP_DOWN}`);
    console.log(`    with resolved strike: ${upDownWithStrike}`);
    console.log(`  range:                ${seen.RANGE}`);
    console.log(`    with floor+cap:     ${rangeWithBounds}`);
    console.log(`    missing bounds:     ${rangeMissingBounds}`);
    console.log(`  other:                ${seen.OTHER}`);

    console.log(`\n--- volume field coverage ---`);
    console.log(`  using volume_24h_fp:  ${using24hVolume}`);
    console.log(`  fallback volume_fp:   ${usingLifetimeVolume}`);
    console.log(`  missing both:         ${missingVolume}`);

    console.log(`\n--- sample per type ---`);
    for (const t of ["UP_DOWN", "RANGE", "OTHER"] as const) {
      const arr = samples[t] ?? [];
      console.log(`[${t}]`);
      for (const s of arr) {
        const bits = [
          `series=${s.series}`,
          `q="${s.question}"`,
        ];
        if (s.subtitle) bits.push(`sub="${s.subtitle}"`);
        if (s.strikeUsd != null) bits.push(`strikeUsd=${s.strikeUsd}`);
        if (s.floorStrikeUsd != null) bits.push(`floor=${s.floorStrikeUsd}`);
        if (s.capStrikeUsd != null) bits.push(`cap=${s.capStrikeUsd}`);
        if (s.volume24hFp != null) bits.push(`vol24h_fp=${s.volume24hFp}`);
        else if (s.volumeFp != null) bits.push(`vol_fp=${s.volumeFp} ⚠lifetime`);
        console.log("    " + bits.join("  "));
      }
    }

    // Sanity assertions.
    let failed = false;
    if (seen.UP_DOWN === 0) {
      console.error(`\n[kalshi] FAIL — no UP_DOWN markets found (greater/less classification broken?)`);
      failed = true;
    }
    if (seen.RANGE === 0) {
      console.error(`\n[kalshi] FAIL — no RANGE markets found (between classification broken?)`);
      failed = true;
    }
    if (rangeMissingBounds > 0) {
      console.error(`\n[kalshi] FAIL — ${rangeMissingBounds} RANGE markets missing floor or cap bounds`);
      failed = true;
    }
    if (usingLifetimeVolume > 0) {
      console.error(`\n[kalshi] FAIL — ${usingLifetimeVolume} markets fell back to lifetime volume (volume_24h_fp is missing or not used)`);
      failed = true;
    }
    if (failed) process.exit(1);

    console.log(`\n[kalshi] OK`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[kalshi] FAIL — ${msg}`);
    if (msg.includes("abort")) {
      console.error(`  (timed out after ${TIMEOUT_MS}ms — network/DNS issue?)`);
    }
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

main();
