/**
 * Smoke-test the Polymarket Gamma API from your local machine. Mirrors
 * what the production fetcher (lib/markets/polymarket.ts) does:
 *   - hit /events with tag_id=235 (the "Bitcoin" tag)
 *   - walk each event's nested markets[]
 *   - narrow to Bitcoin via the event-level `tags[].slug` field
 *   - classify each remaining market as UP_DOWN / RANGE / OTHER
 *   - parse strike from groupItemTitle for ladders
 *   - parse floor/cap from groupItemTitle "low-high" for range markets
 *
 *   npx tsx scripts/test-polymarket.ts
 *
 * Exits non-zero if no BTC markets are found, or if no up/down or
 * range markets are classified (something is wrong upstream or the
 * production filter is too strict).
 */

const BASE = "https://gamma-api.polymarket.com";
const TIMEOUT_MS = 20_000;

interface RawTag {
  id?: string;
  slug?: string;
  label?: string;
}

interface RawEvent {
  id: string;
  slug: string;
  title: string;
  tags?: RawTag[];
  series?: Array<{ ticker?: string; slug?: string; cgAssetName?: string }>;
  markets?: RawMarket[];
}

interface RawMarket {
  id?: string;
  slug?: string;
  question?: string;
  closed?: boolean;
  active?: boolean;
  outcomes?: string;
  outcomePrices?: string;
  endDate?: string;
  volume24hr?: number;
  bestBid?: number | string;
  bestAsk?: number | string;
  groupItemTitle?: string;
  groupItemThreshold?: string;
  groupItemRange?: string;
  tags?: RawTag[];
}

// ── Inline copy of the production classifier + parser (kept in sync
// with the lib version, but standalone so the test runs without bundling).

type MarketType = "UP_DOWN" | "RANGE" | "OTHER";

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

async function main() {
  // /events with tag_id=235 = "bitcoin". Server-filters to every active
  // BTC event (up/down, multi-strike, range, intraday) in one round trip.
  const url = `${BASE}/events?tag_id=235&active=true&closed=false&limit=200`;
  console.log(`[polymarket] GET ${url}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: ctrl.signal,
    });
    const elapsed = Date.now() - t0;
    console.log(`[polymarket] HTTP ${res.status} in ${elapsed}ms`);

    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      console.error(`[polymarket] FAIL — status ${res.status}`);
      console.error(body.slice(0, 500));
      process.exit(1);
    }

    const events = (await res.json()) as RawEvent[];
    console.log(`[polymarket] received ${events.length} events`);

    // Walk events → markets, mirroring the production fetcher.
    const btcEvents = events.filter(isBitcoinEvent);
    const btcMarkets: Array<{ event: RawEvent; market: RawMarket }> = [];
    for (const e of btcEvents) {
      for (const m of e.markets ?? []) {
        btcMarkets.push({ event: e, market: m });
      }
    }
    console.log(`[polymarket] BTC events: ${btcEvents.length}`);
    console.log(`[polymarket] BTC markets (across events): ${btcMarkets.length}`);

    if (btcMarkets.length === 0) {
      console.error(`[polymarket] FAIL — no BTC markets after filter`);
      process.exit(1);
    }

    // Classify by type, count by category and by type.
    const seen = { UP_DOWN: 0, RANGE: 0, OTHER: 0 } as Record<MarketType, number>;
    let strikeCount = 0;
    let rangeBoundCount = 0;
    const samples: Record<
      MarketType,
      | { question: string; slug: string; outcomes: string; endDate?: string;
          groupItemTitle?: string; groupItemRange?: string;
          parsedStrike?: number; parsedRange?: [number, number] }
      | null
    > = {
      UP_DOWN: null,
      RANGE: null,
      OTHER: null,
    };

    for (const { market: m } of btcMarkets) {
      if (m.closed || m.active === false) continue;

      // Mirror production classification: prefer the structured
      // groupItemTitle signal, fall back to the question-text heuristic.
      const parsed = parseGroupItemTitle(m.groupItemTitle);
      let t: MarketType;
      let parsedStrike: number | undefined;
      let parsedRange: [number, number] | undefined;
      if (parsed && "range" in parsed) {
        t = "RANGE";
        parsedRange = parsed.range;
        rangeBoundCount += 1;
      } else if (parsed && "strike" in parsed) {
        t = "UP_DOWN";
        parsedStrike = parsed.strike;
        strikeCount += 1;
      } else {
        t = toMarketType(m.question ?? "");
      }
      seen[t] += 1;
      if (samples[t] === null) {
        samples[t] = {
          question: (m.question ?? "").slice(0, 80),
          slug: m.slug ?? "",
          outcomes: m.outcomes ?? "",
          endDate: m.endDate,
          groupItemTitle: m.groupItemTitle,
          groupItemRange: m.groupItemRange,
          parsedStrike,
          parsedRange,
        };
      }
    }

    console.log(`\n--- breakdown ---`);
    console.log(`total events:         ${events.length}`);
    console.log(`btc events:           ${btcEvents.length}`);
    console.log(`btc markets:          ${btcMarkets.length}`);
    console.log(`  up/down:            ${seen.UP_DOWN}`);
    console.log(`    with parsed strike:  ${strikeCount}`);
    console.log(`  range:              ${seen.RANGE}`);
    console.log(`    with parsed bounds:  ${rangeBoundCount}`);
    console.log(`  other:              ${seen.OTHER}`);

    console.log(`\n--- sample questions per type ---`);
    for (const t of ["UP_DOWN", "RANGE", "OTHER"] as const) {
      const s = samples[t];
      if (s) {
        console.log(`[${t}] ${s.question}`);
        const bits = [
          `slug=${s.slug}`,
          `outcomes=${s.outcomes}`,
          `endDate=${s.endDate ?? "n/a"}`,
        ];
        if (s.groupItemTitle) bits.push(`groupItemTitle="${s.groupItemTitle}"`);
        if (s.groupItemRange) bits.push(`groupItemRange=${s.groupItemRange}`);
        if (s.parsedStrike != null) bits.push(`parsedStrike=${s.parsedStrike}`);
        if (s.parsedRange) bits.push(`parsedRange=[${s.parsedRange[0]}..${s.parsedRange[1]}]`);
        console.log(`        ${bits.join("  ")}`);
      } else {
        console.log(`[${t}] (no sample)`);
      }
    }

    // Sanity: at minimum we want SOME up/down or range markets.
    if (seen.UP_DOWN === 0 && seen.RANGE === 0) {
      console.error(`\n[polymarket] FAIL — no up/down or range BTC markets found`);
      process.exit(1);
    }

    // Sanity: range markets should have parsed bounds.
    if (seen.RANGE > 0 && rangeBoundCount === 0) {
      console.error(`\n[polymarket] FAIL — range markets found but no bounds parsed from groupItemTitle`);
      process.exit(1);
    }

    console.log(`\n[polymarket] OK`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[polymarket] FAIL — ${msg}`);
    if (msg.includes("abort")) {
      console.error(`  (timed out after ${TIMEOUT_MS}ms — network/DNS issue?)`);
    }
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

main();
