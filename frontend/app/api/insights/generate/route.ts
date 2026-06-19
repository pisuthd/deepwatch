/**
 * `POST /api/insights/generate` — server-proxied MiniMax call.
 *
 * The browser cannot call MiniMax directly because the API key is
 * server-only (no `NEXT_PUBLIC_` prefix, never bundled into the client).
 *
 * Two request shapes share this route:
 *
 *  1. **Legacy single-market flow** (wizard / Predict page) —
 *     `{ title, asset, includes }`. Streams freeform prose with
 *     thinking + text deltas. Same shape as before.
 *
 *  2. **Batch flow** (Compare page) — `{ kind: 'batch', cmcContext,
 *     matches: [...] }`. One upstream call analyses all visible
 *     matches at once. Uses Anthropic's native `tools` API with a
 *     `record_market_signal` tool that returns one structured result
 *     per market (signal + confidence + positionSizePct + reasoning).
 *     The macro context (Fear & Greed sentiment + 24h sector trends
 *     from CoinMarketCap) is fed in once per request and applied to
 *     every market in the batch — per user direction:
 *     "ideally if 20 markets, ai should analyse one global data with
 *     Coinmarketcapi and each market params + Kalshi + Polymakret ->
 *     result to each market in strucure, up or down or neutal and how
 *     much to put."
 *
 * **Why tool use, not freeform prose (per user feedback):**
 * Freeform output forced the client to scrape a strict Summary block
 * out of markdown prose — fragile, easy for the model to drift on,
 * impossible to attribute a result to a specific row when the model
 * batched its answer into a single blob. With tool calls, each market
 * gets its own atomic `record_market_signal` invocation with a typed
 * `input_schema`, so the server (and the client) can validate the
 * shape before persisting.
 *
 * **Why no absolute BTC dominance in `cmcContext`** (per user
 * feedback): "BTC alway dominance the market maybe sentiment is
 * meaning." Absolute dominance is essentially constant on a 24h
 * horizon (always in the 50–60% band) and isn't actionable on its
 * own. The route feeds the Fear & Greed index (sentiment — the
 * primary macro signal) and the *24h change* in BTC/ETH dominance
 * plus DeFi/stablecoin/derivatives sector 24h % (sector trend) plus
 * total market cap and 24h volume as backdrop.
 *
 * Upstream contract: Anthropic-compatible Messages API
 * (`POST {baseUrl}/v1/messages`, `x-api-key` auth, `stream: true`).
 * The configured `MINIMAX_BASE_URL` already points at MiniMax's
 * `/anthropic` compatibility shim, so the request shape and SSE
 * event names match Anthropic's spec.
 *
 * Environment:
 *   MINIMAX_API_KEY          server-only; sent as `x-api-key`
 *   MINIMAX_BASE_URL         server-only; e.g. https://api.minimax.io/anthropic
 *   MINIMAX_MODEL            server-only; defaults to 'MiniMax-M3'
 *   MINIMAX_THINKING_BUDGET  server-only; tokens reserved for reasoning
 *                            (default 2048; set to 0 to disable thinking)
 *   CMC_API_KEY              server-only; sent to CoinMarketCap on
 *                            server-side fetches. Cache: 60 s in-memory.
 *
 * Response: `text/event-stream`. Frames:
 *   data: {"k":"thinking","t":"<token>"}
 *   data: {"k":"text","t":"<token>"}
 *   data: {"k":"tool_start","t":"<tool_name>"}
 *   data: {"k":"result","t":<serialised MatchAnalysisToolInput>}
 *   data: {"k":"error","t":"<message>"}     (on upstream or parse failure)
 *   data: [DONE]
 *
 * The client parser (`app/lib/minimax.ts`) routes each `k` value to
 * the right chunk-kind variant of `InsightBatchChunk`.
 */

import type { NextRequest } from 'next/server';
import type { CmcContext } from '@/app/lib/match-analyses';
import {
  validateMatchAnalysisToolInput,
  type MatchAnalysisToolInput,
} from '@/app/lib/match-analyses';

const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL ?? '';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? '';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-M3';
const MINIMAX_THINKING_BUDGET = Number(process.env.MINIMAX_THINKING_BUDGET ?? 2048);
const ANTHROPIC_VERSION = '2023-06-01';
// Bumped from 4096 → 16384: 20 markets × ~600 tokens of structured tool
// output (input JSON + envelope) per market, plus the macro context block,
// system prompt, and a small thinking reserve, can exceed 4K. A truncated
// stream (where the model runs out of tokens mid-batch) is the worst
// outcome — 16K comfortably covers the worst-case 20-market batch while
// still keeping the request cheap.
const MAX_TOKENS = Number(process.env.MINIMAX_BATCH_MAX_TOKENS ?? 16384);
const CMC_BASE = 'https://pro-api.coinmarketcap.com';
const CMC_API_KEY = process.env.CMC_API_KEY ?? '';
const CMC_CACHE_TTL_MS = 60_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Request shapes ────────────────────────────────────────────────────

interface LegacyGenerateRequest {
  title: string;
  asset: string;
  includes: unknown;
}

interface BatchGenerateMatchInput {
  key: string;
  dbQuestion: string;
  asset: string;
  expiryMs: number;
  dbProb: number;
  polyProb?: number;
  kalshiProb?: number;
  spread?: number;
  polyQuestion?: string;
  kalshiQuestion?: string;
  polyUrl?: string;
  kalshiUrl?: string;
}

interface BatchGenerateRequest {
  kind: 'batch';
  cmcContext: CmcContext | null;
  matches: BatchGenerateMatchInput[];
}

// ─── Legacy SYSTEM_PROMPT (kept verbatim for the wizard flow) ───────────

const LEGACY_SYSTEM_PROMPT = [
  'You are a cross-venue prediction-market analyst. The user is looking at the same BTC binary event priced on three venues — DeepBook Predict, Polymarket, and Kalshi — and wants to know where the edge is.',
  '',
  '# Input',
  'You receive three ladders for the same expiry, each with implied probability of "UP" at standard strikes (or "in band" for range bands):',
  '- `live.dbComputed` — DeepBook Predict, projected from the oracle\'s SVI surface (5 strikes + 3 range bands). May be `null` if SVI is missing.',
  '- `live.poly` — Polymarket, live order book. May be `null` if no match within tolerance.',
  '- `live.kalshi` — Kalshi, live order book. May be `null` if no match within tolerance.',
  'Each row has `impliedProbUp` (0–1). Range rows also carry `floorStrikeUsd` / `capStrikeUsd` / `rangeBandPct`.',
  '',
  '# Your job',
  'For each strike (or range band) where at least 2 venues have a quote, compute the spread (max − min impliedProb). Identify the strikes with the largest spread — those are the actionable ones. Quote the actual numbers, not summaries.',
  'Your output is a directional read: up / down / neutral, the bias (bullish / bearish / range-bound), and a one-sentence actionable takeaway the user can act on (e.g. "long UP at Polymarket\'s $X strike, hedge with DOWN on Kalshi at $Y", or "wait — spreads too thin to act").',
  '',
  '# Output format (strict)',
  '1. `# <Title>` (H1)',
  '2. `## Cross-venue snapshot`',
  '   - A markdown table. Columns: `Strike` | `DeepBook` | `Polymarket` | `Kalshi` | `Spread`.',
  '   - Use `n/a` for missing venues. Sort rows so the largest spread is at the top.',
  '   - Bold the row with the biggest spread.',
  '3. `## Where the edge is`',
  '   - 2–3 sentences. Name the strike + venues with the biggest divergence. Which venue is "cheap" (lowest implied prob) vs "expensive" (highest). The trade idea in plain language.',
  '4. `## DeepBook Predict` — 1–2 sentences on what the SVI surface says (spot vs forward, vol regime, skew). Skip if `dbComputed` is null.',
  '5. `## Polymarket` — 1–2 sentences. Or "No match at this expiry." if null.',
  '6. `## Kalshi` — 1–2 sentences. Or "No match at this expiry." if null.',
  '7. `## Summary`',
  '   - **Direction**: up / down / neutral',
  '   - **Bias**: bullish / bearish / range-bound',
  '   - **Action**: one sentence the user can act on now',
  '',
  '# Rules',
  '- Use ONLY numbers from the input. Never invent strikes or implied probs.',
  '- If a venue is `null` or has zero rows, skip it — do not fabricate quotes.',
  '- If only 1 venue has a quote at a strike, drop that row from the spread table (no spread to compute).',
  '- Use GitHub-flavored markdown (headings, tables, **bold**, inline code).',
  '- Be concrete: "Polymarket 51% / Kalshi 48% at $110k → 3% spread, largest on the board" beats "there is divergence between venues".',
  '- Implied probability is always between 0 and 1; format as percentages with 1 decimal in prose ("51.2%") and 0–1 in the table cells ("0.512").',
].join('\n');

// ─── Batch SYSTEM_PROMPT ────────────────────────────────────────────────

const BATCH_SYSTEM_PROMPT = [
  'You are a cross-venue prediction-market analyst for the **DeepBook Predict** platform.',
  '',
  '**DeepBook Predict is the TRADING VENUE** — the only place the user actually places bets. Polymarket and Kalshi are REFERENCE DATA — they show what other venues think, so you can spot when DeepBook Predict\'s price disagrees with the rest of the market.',
  '',
  '**You DO recommend trades on DeepBook Predict** (UP / DOWN + position size). **You do NOT trade Polymarket or Kalshi** — they are inputs to the analysis, not trade targets.',
  '',
  '# Input',
  'For each market, you receive implied probabilities of the UP outcome from up to three venues:',
  '- `dbProb` — DeepBook Predict (the venue the user trades on). Always present.',
  '- `polyProb` — Polymarket (reference). May be null if no match at this expiry.',
  '- `kalshiProb` — Kalshi (reference). May be null if no match at this expiry.',
  '- `cmcContext` — macro snapshot (Fear & Greed index, 24h sector trend, total market cap).',
  '',
  '# Your job',
  'For each DeepBook Predict market, decide whether the user should bet UP, DOWN, or stay flat on DeepBook Predict specifically — and how much bankroll to allocate. Output one tool call per market.',
  '',
  '# Tool',
  'You MUST use the `record_market_signal` tool exactly once per market, in the order they appear. Do not produce any other text. Do not skip markets. Do not call the tool twice for the same market.',
  '',
  '# Decision framework (mechanical — apply in order)',
  '1. `consensus` = median of the present venue probs (whatever is present among DB / Poly / Kalshi).',
  '2. `dbVsConsensusPp` = (dbProb − consensus) × 100. This is the ONLY directional input.',
  '3. Direction rule:',
  '   - `|dbVsConsensusPp| < 2` → IN_LINE → signal = NEUTRAL, positionSizePct = 0 (no edge).',
  '   - `dbVsConsensusPp < −2` (negative) → DB is CHEAP (DB undervalues UP) → bet UP on DeepBook Predict.',
  '   - `dbVsConsensusPp > +2` (positive) → DB is RICH (DB overvalues UP) → bet DOWN on DeepBook Predict.',
  '4. Position size scales with `|dbVsConsensusPp|` and inversely with how many venues are missing:',
  '   - All 3 venues + |pp| ≥ 15 → up to 8% bankroll',
  '   - All 3 venues + |pp| 5–15 → 3–6% bankroll',
  '   - All 3 venues + |pp| 2–5 → 1–2% bankroll',
  '   - 2 venues present (one missing) → halve the position size',
  '   - 1 venue present → NEUTRAL, positionSizePct = 0 (no cross-venue comparison possible)',
  '5. `confidence` (0–1) reflects how strong the divergence is AND how clean the data is. All 3 venues + large |pp| = high confidence. Missing venues = lower confidence. Don\'t predict direction; rate the data quality.',
  '',
  '# Worked examples',
  '- DB 18.6%, Poly 11.5%, Kalshi 59% → consensus = 18.6 (median). dbVsConsensusPp = 0. IN_LINE → NEUTRAL. Spread is large but DB sits at median.',
  '- DB 55%, Poly 51%, Kalshi 48% → consensus = 51. dbVsConsensusPp = +4. DB rich by 4pp → bet DOWN on DB. positionSizePct = 2.',
  '- DB 12%, Poly 28%, Kalshi 30% → consensus = 28. dbVsConsensusPp = −16. DB cheap by 16pp → bet UP on DB. positionSizePct = 7.',
  '- DB 75%, Poly 28% (Kalshi null) → only 2 venues, consensus = 28 (median of 28, 75). dbVsConsensusPp = +47. DB rich, bet DOWN on DB. Halve the size because Kalshi is missing → positionSizePct = 6.',
  '- DB 30% (Poly null, Kalshi null) → 1 venue only. NEUTRAL, positionSizePct = 0.',
  '',
  '# Per-market rules',
  '- Use ONLY numbers from the input. Never invent strikes or implied probs.',
  '- `reasoning` (≤ 200 chars): one sentence citing DB\'s price, the consensus, and the action on DeepBook Predict, e.g. "DB 18% vs consensus 35% — DB cheap by 17pp, bet UP on DB" or "DB 55% vs consensus 51% — DB rich by 4pp, bet DOWN on DB".',
  '- `macroTake` (≤ 120 chars): REQUIRED when `cmcContext` is present. One short line citing the macro backdrop. Examples:',
  '  - "Fear 19 (extreme fear) + DeFi −7% — washed out, no override"',
  '  - "Fear 50, sector flat — no macro override"',
  '  - "Fear 78 + derivatives −10% — overextended, sizing down"',
  '  - "Macro data n/a"',
  '  - Omit `macroTake` ONLY when `cmcContext` is null (no upstream data at all).',
  '',
  '# Macro context rules',
  '- Macro is BACKDROP only. Never override the cross-venue numbers with macro opinion.',
  '- `macroTake` should DESCRIBE the macro state, not recommend a direction.',
  '- Macro can slightly adjust position sizing (extreme fear = lean aggressive on UP, extreme greed = lean conservative) but NEVER flips the direction.',
].join('\n');

// ─── Anthropic tool definition ──────────────────────────────────────────

const RECORD_MARKET_SIGNAL_TOOL = {
  name: 'record_market_signal',
  description:
    'Record the AI\'s directional read for one DeepBook Predict market. ' +
    'DeepBook Predict is the TRADING VENUE — the call is for a position ON DeepBook Predict, not on Polymarket or Kalshi (those are reference data only). ' +
    'Call this tool exactly once per market, in the order the markets are presented.',
  input_schema: {
    type: 'object',
    properties: {
      matchKey: {
        type: 'string',
        description:
          'The market\'s stable key, equal to DeepBookMatch.key (${oracleId}::${expiryMs})',
      },
      signal: {
        type: 'string',
        enum: ['UP', 'DOWN', 'NEUTRAL'],
        description:
          'The side to bet on DeepBook Predict. UP = bet the UP outcome on DeepBook Predict, DOWN = bet the DOWN outcome on DeepBook Predict, NEUTRAL = no edge, stay flat.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description:
          'Confidence in the cross-venue divergence assessment, 0.0–1.0. Don\'t predict direction; rate the data quality. Larger |DB vs consensus| + all 3 venues = higher confidence.',
      },
      positionSizePct: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description:
          'Suggested allocation of bankroll on DeepBook Predict for this market, 0–100%. NEUTRAL signal should always be 0. Halve the size when one venue is missing.',
      },
      reasoning: {
        type: 'string',
        description:
          'One sentence explaining the call. ≤ 200 chars. Cite DB\'s price vs the cross-venue consensus and the action on DeepBook Predict, e.g. "DB 18% vs consensus 35% — DB cheap by 17pp, bet UP on DB" or "DB 55% vs consensus 51% — DB rich by 4pp, bet DOWN on DB".',
      },
      macroTake: {
        type: 'string',
        description:
          'One short line citing the macro backdrop (Fear & Greed + 24h sector trend) that drove (or didn\'t drive) this call. ≤ 120 chars. REQUIRED when macro context is present, optional otherwise. Examples: "Fear 22 + DeFi −7% — washed out, no override", "Fear 50, sector flat — no macro override", "Macro data n/a".',
      },
    },
    required: ['matchKey', 'signal', 'confidence', 'positionSizePct', 'reasoning'],
  },
} as const;

// ─── CMC context fetch (server-side, with in-memory cache) ──────────────

interface CachedCmcContext {
  fetchedAt: number;
  context: CmcContext;
}

let cmcCache: CachedCmcContext | null = null;

function isCmcCacheFresh(c: CachedCmcContext | null): c is CachedCmcContext {
  return !!c && Date.now() - c.fetchedAt < CMC_CACHE_TTL_MS;
}

interface RawFearGreed {
  data?: {
    value?: number;
    update_time?: string;
    value_classification?: string;
  };
}

interface RawGlobalMetrics {
  data?: {
    btc_dominance_24h_percentage_change?: number;
    eth_dominance_24h_percentage_change?: number;
    active_cryptocurrencies?: number;
    quote?: {
      USD?: {
        total_market_cap?: number;
        total_volume_24h?: number;
        defi_24h_percentage_change?: number;
        stablecoin_24h_percentage_change?: number;
        derivatives_24h_percentage_change?: number;
      };
    };
  };
}

async function fetchFearGreed(signal: AbortSignal): Promise<{
  value: number | null;
  label: string | null;
  updatedAt: string | null;
}> {
  if (!CMC_API_KEY) {
    console.warn('[cmc] fear-and-greed skipped: CMC_API_KEY is empty');
    return { value: null, label: null, updatedAt: null };
  }
  try {
    const res = await fetch(`${CMC_BASE}/v3/fear-and-greed/latest`, {
      headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY },
      signal,
    });
    if (!res.ok) {
      // Body might explain the failure (invalid key, plan doesn't cover
      // the endpoint, etc.). Read it for the warn so the server logs
      // tell us what's actually wrong instead of just "401".
      const errBody = await res.text().catch(() => '');
      console.warn(
        `[cmc] fear-and-greed HTTP ${res.status} ${res.statusText}: ${errBody.slice(0, 200)}`,
      );
      return { value: null, label: null, updatedAt: null };
    }
    const json = (await res.json()) as RawFearGreed;
    return {
      value: typeof json.data?.value === 'number' ? json.data.value : null,
      label:
        typeof json.data?.value_classification === 'string'
          ? json.data.value_classification
          : null,
      updatedAt:
        typeof json.data?.update_time === 'string' ? json.data.update_time : null,
    };
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw err;
    console.warn('[cmc] fear-and-greed fetch failed:', err);
    return { value: null, label: null, updatedAt: null };
  }
}

async function fetchGlobalMetrics(signal: AbortSignal): Promise<{
  btcDominance24hChange: number | null;
  ethDominance24hChange: number | null;
  defi24hChange: number | null;
  stablecoin24hChange: number | null;
  derivatives24hChange: number | null;
  totalMarketCapUsd: number | null;
  totalVolume24hUsd: number | null;
  activeCryptocurrencies: number | null;
}> {
  if (!CMC_API_KEY) {
    console.warn('[cmc] global-metrics skipped: CMC_API_KEY is empty');
    return {
      btcDominance24hChange: null,
      ethDominance24hChange: null,
      defi24hChange: null,
      stablecoin24hChange: null,
      derivatives24hChange: null,
      totalMarketCapUsd: null,
      totalVolume24hUsd: null,
      activeCryptocurrencies: null,
    };
  }
  try {
    const res = await fetch(`${CMC_BASE}/v1/global-metrics/quotes/latest`, {
      headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY },
      signal,
    });
    if (!res.ok) {
      // Body might explain the failure (invalid key, plan doesn't cover
      // the endpoint, etc.). Read it for the warn so the server logs
      // tell us what's actually wrong instead of just "401".
      const errBody = await res.text().catch(() => '');
      console.warn(
        `[cmc] global-metrics HTTP ${res.status} ${res.statusText}: ${errBody.slice(0, 200)}`,
      );
      return {
        btcDominance24hChange: null,
        ethDominance24hChange: null,
        defi24hChange: null,
        stablecoin24hChange: null,
        derivatives24hChange: null,
        totalMarketCapUsd: null,
        totalVolume24hUsd: null,
        activeCryptocurrencies: null,
      };
    }
    const json = (await res.json()) as RawGlobalMetrics;
    const usd = json.data?.quote?.USD;
    return {
      btcDominance24hChange:
        typeof json.data?.btc_dominance_24h_percentage_change === 'number'
          ? json.data.btc_dominance_24h_percentage_change
          : null,
      ethDominance24hChange:
        typeof json.data?.eth_dominance_24h_percentage_change === 'number'
          ? json.data.eth_dominance_24h_percentage_change
          : null,
      defi24hChange:
        typeof usd?.defi_24h_percentage_change === 'number'
          ? usd.defi_24h_percentage_change
          : null,
      stablecoin24hChange:
        typeof usd?.stablecoin_24h_percentage_change === 'number'
          ? usd.stablecoin_24h_percentage_change
          : null,
      derivatives24hChange:
        typeof usd?.derivatives_24h_percentage_change === 'number'
          ? usd.derivatives_24h_percentage_change
          : null,
      totalMarketCapUsd:
        typeof usd?.total_market_cap === 'number' ? usd.total_market_cap : null,
      totalVolume24hUsd:
        typeof usd?.total_volume_24h === 'number' ? usd.total_volume_24h : null,
      activeCryptocurrencies:
        typeof json.data?.active_cryptocurrencies === 'number'
          ? json.data.active_cryptocurrencies
          : null,
    };
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw err;
    console.warn('[cmc] global-metrics fetch failed:', err);
    return {
      btcDominance24hChange: null,
      ethDominance24hChange: null,
      defi24hChange: null,
      stablecoin24hChange: null,
      derivatives24hChange: null,
      totalMarketCapUsd: null,
      totalVolume24hUsd: null,
      activeCryptocurrencies: null,
    };
  }
}

async function fetchCmcContext(signal: AbortSignal): Promise<CmcContext> {
  if (isCmcCacheFresh(cmcCache)) return cmcCache.context;
  const [fg, gm] = await Promise.all([
    fetchFearGreed(signal),
    fetchGlobalMetrics(signal),
  ]);
  const context: CmcContext = {
    fearGreedValue: fg.value,
    fearGreedLabel: fg.label,
    fearGreedUpdatedAt: fg.updatedAt,
    btcDominance24hChange: gm.btcDominance24hChange,
    ethDominance24hChange: gm.ethDominance24hChange,
    defi24hChange: gm.defi24hChange,
    stablecoin24hChange: gm.stablecoin24hChange,
    derivatives24hChange: gm.derivatives24hChange,
    totalMarketCapUsd: gm.totalMarketCapUsd,
    totalVolume24hUsd: gm.totalVolume24hUsd,
    activeCryptocurrencies: gm.activeCryptocurrencies,
    fetchedAt: Date.now(),
  };
  cmcCache = { fetchedAt: context.fetchedAt, context };
  return context;
}

// ─── Prompt builders ────────────────────────────────────────────────────

function buildLegacyUserPrompt(body: LegacyGenerateRequest): string {
  const live = (body.includes as {
    live?: { dbComputed?: unknown; poly?: unknown; kalshi?: unknown };
  } | null)?.live;
  const dbComputed = live?.dbComputed;
  const poly = live?.poly;
  const kalshi = live?.kalshi;

  return [
    `# Context`,
    `Title: ${body.title}`,
    `Asset: ${body.asset}`,
    '',
    '# Venues',
    '- DeepBook Predict: ' + (dbComputed ? 'SVI ladder available' : 'no SVI data'),
    '- Polymarket: ' + (poly ? 'match found' : 'no match at this expiry'),
    '- Kalshi: ' + (kalshi ? 'match found' : 'no match at this expiry'),
    '',
    '# Collected data (raw)',
    '```json',
    JSON.stringify(body.includes, null, 2),
    '```',
    '',
    'Write the full markdown analysis now. Cross-venue spread table first, then the edge, then per-venue notes, then summary.',
  ].join('\n');
}

function fmtPctOrNa(p: number | undefined): string {
  if (typeof p !== 'number' || !Number.isFinite(p)) return 'no match';
  return `${(p * 100).toFixed(1)}%`;
}

function buildBatchUserPrompt(
  cmcContext: CmcContext | null,
  matches: BatchGenerateMatchInput[],
): string {
  const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const fmtIso = (ms: number) => new Date(ms).toISOString();
  const lines: string[] = [];

  if (cmcContext) {
    lines.push(
      `# Macro context (snapshot at ${new Date(cmcContext.fetchedAt).toISOString()})`,
    );
    lines.push('');
    lines.push('Sentiment (primary):');
    lines.push(
      `- Fear & Greed: ${
        cmcContext.fearGreedValue !== null ? cmcContext.fearGreedValue : 'n/a'
      }${
        cmcContext.fearGreedLabel ? ` (${cmcContext.fearGreedLabel})` : ''
      }${
        cmcContext.fearGreedUpdatedAt
          ? `, updated ${cmcContext.fearGreedUpdatedAt}`
          : ''
      }`,
    );
    lines.push('');
    lines.push('24h sector trend (secondary):');
    lines.push(`- DeFi: ${cmcContext.defi24hChange ?? 'n/a'}%`);
    lines.push(`- Stablecoins: ${cmcContext.stablecoin24hChange ?? 'n/a'}%`);
    lines.push(`- Derivatives: ${cmcContext.derivatives24hChange ?? 'n/a'}%`);
    lines.push(
      `- BTC dominance 24h: ${cmcContext.btcDominance24hChange ?? 'n/a'}pp (negative = altcoin rotation)`,
    );
    lines.push(
      `- ETH dominance 24h: ${cmcContext.ethDominance24hChange ?? 'n/a'}pp`,
    );
    lines.push('');
    lines.push('Backdrop:');
    lines.push(
      `- Total market cap: ${
        cmcContext.totalMarketCapUsd !== null
          ? fmtUsd(cmcContext.totalMarketCapUsd)
          : 'n/a'
      }`,
    );
    lines.push(
      `- Total 24h volume: ${
        cmcContext.totalVolume24hUsd !== null
          ? fmtUsd(cmcContext.totalVolume24hUsd)
          : 'n/a'
      }`,
    );
    lines.push(
      `- Active cryptocurrencies: ${cmcContext.activeCryptocurrencies ?? 'n/a'}`,
    );
    lines.push('');
  } else {
    lines.push('# Macro context');
    lines.push('');
    lines.push('CoinMarketCap snapshot unavailable — treat macro as n/a.');
    lines.push('');
  }

  lines.push(`# Markets (${matches.length} total)`);
  lines.push('');
  lines.push(
    'Call the `record_market_signal` tool once per market, in this order:',
  );
  lines.push('');

  matches.forEach((m, i) => {
    lines.push(`## ${i + 1}. matchKey=${m.key}`);
    lines.push(`Question: ${m.dbQuestion}`);
    lines.push(`Expiry: ${fmtIso(m.expiryMs)}`);
    lines.push(`DB YES (ATM): ${fmtPctOrNa(m.dbProb)}`);
    lines.push(`Polymarket YES: ${fmtPctOrNa(m.polyProb)}`);
    lines.push(`Kalshi YES: ${fmtPctOrNa(m.kalshiProb)}`);
    lines.push(
      `Spread: ${typeof m.spread === 'number' ? `${(m.spread * 100).toFixed(1)}%` : 'n/a'}`,
    );
    if (m.polyQuestion) lines.push(`Polymarket question: ${m.polyQuestion}`);
    if (m.kalshiQuestion) lines.push(`Kalshi question: ${m.kalshiQuestion}`);
    lines.push('');
  });

  lines.push('Begin now. One tool call per market, in order.');
  return lines.join('\n');
}

// ─── Route entry point ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!MINIMAX_API_KEY || !MINIMAX_BASE_URL) {
    return new Response(
      'MiniMax is not configured. Set MINIMAX_API_KEY and MINIMAX_BASE_URL in your server environment.',
      { status: 503 },
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  // Dispatch to the right flow.
  if (raw && typeof raw === 'object' && raw.kind === 'batch') {
    return handleBatch(raw as unknown as BatchGenerateRequest, req.signal);
  }
  return handleLegacy(raw as unknown as LegacyGenerateRequest);
}

function handleLegacy(body: LegacyGenerateRequest): Response {
  if (!body.title || !body.asset) {
    return new Response('title and asset are required', { status: 400 });
  }
  const userPrompt = buildLegacyUserPrompt(body);
  return streamFreeformCompletion(LEGACY_SYSTEM_PROMPT, userPrompt);
}

function handleBatch(body: BatchGenerateRequest, signal: AbortSignal): Response {
  if (!Array.isArray(body.matches) || body.matches.length === 0) {
    return new Response('matches[] is required and must be non-empty', {
      status: 400,
    });
  }
  // Use the client-supplied cmcContext if present; otherwise fetch a
  // fresh one server-side. The server fetch is the same path the
  // standalone `/api/cmc/context` route exposes; the cache is
  // process-local and shared.
  const cmcPromise: Promise<CmcContext> = body.cmcContext
    ? Promise.resolve(body.cmcContext)
    : fetchCmcContext(signal);
  return streamBatchCompletion(body.matches, cmcPromise, signal);
}

function streamFreeformCompletion(
  systemPrompt: string,
  userPrompt: string,
): Response {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const upstreamBody: Record<string, unknown> = {
    model: MINIMAX_MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (MINIMAX_THINKING_BUDGET > 0) {
    upstreamBody.thinking = {
      type: 'enabled',
      budget_tokens: Math.min(MINIMAX_THINKING_BUDGET, MAX_TOKENS - 1),
    };
  }

  const transform = new ReadableStream<Uint8Array>({
    async start(controller) {
      let upstream: Response;
      try {
        upstream = await fetch(`${MINIMAX_BASE_URL}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': MINIMAX_API_KEY,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(upstreamBody),
        });
      } catch (err) {
        emitErrorAndClose(controller, encoder, (err as Error).message ?? 'upstream fetch failed');
        return;
      }
      if (!upstream.ok || !upstream.body) {
        const errText = await upstream.text().catch(() => '');
        emitErrorAndClose(
          controller,
          encoder,
          `MiniMax request failed: ${upstream.status} ${upstream.statusText} ${errText}`.trim(),
        );
        return;
      }
      const reader = upstream.body.getReader();
      let buf = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const eventType = parseSseEventType(frame);
            const data = parseSseData(frame);
            if (eventType === 'content_block_delta' && data) {
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.delta ?? {};
                let kind: 'thinking' | 'text' | null = null;
                let text: string | null = null;
                if (
                  delta.type === 'thinking_delta' &&
                  typeof delta.thinking === 'string' &&
                  delta.thinking.length > 0
                ) {
                  kind = 'thinking';
                  text = delta.thinking;
                } else if (
                  delta.type === 'text_delta' &&
                  typeof delta.text === 'string' &&
                  delta.text.length > 0
                ) {
                  kind = 'text';
                  text = delta.text;
                }
                if (kind && text !== null) {
                  const payload = JSON.stringify({ k: kind, t: text });
                  controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                }
              } catch {
                // Ignore malformed frames / heartbeats.
              }
            } else if (eventType === 'message_stop') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } else if (eventType === 'error' && data) {
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }
        }
        if (buf.trim().length > 0) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new Response(transform, sseHeaders());
}

function streamBatchCompletion(
  matches: BatchGenerateMatchInput[],
  cmcPromise: Promise<CmcContext>,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transform = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const cmc = await cmcPromise;
        const userPrompt = buildBatchUserPrompt(cmc, matches);

        const upstreamBody: Record<string, unknown> = {
          model: MINIMAX_MODEL,
          max_tokens: MAX_TOKENS,
          stream: true,
          system: BATCH_SYSTEM_PROMPT,
          tools: [RECORD_MARKET_SIGNAL_TOOL],
          tool_choice: {
            type: 'tool',
            name: 'record_market_signal',
          },
          messages: [{ role: 'user', content: userPrompt }],
        };
        if (MINIMAX_THINKING_BUDGET > 0) {
          upstreamBody.thinking = {
            type: 'enabled',
            budget_tokens: Math.min(MINIMAX_THINKING_BUDGET, MAX_TOKENS - 1),
          };
        }

        let upstream: Response;
        try {
          upstream = await fetch(`${MINIMAX_BASE_URL}/v1/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': MINIMAX_API_KEY,
              'anthropic-version': ANTHROPIC_VERSION,
            },
            body: JSON.stringify(upstreamBody),
            signal,
          });
        } catch (err) {
          if ((err as { name?: string }).name === 'AbortError') return;
          emitErrorAndClose(
            controller,
            encoder,
            (err as Error).message ?? 'upstream fetch failed',
          );
          return;
        }

        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text().catch(() => '');
          emitErrorAndClose(
            controller,
            encoder,
            `MiniMax request failed: ${upstream.status} ${upstream.statusText} ${errText}`.trim(),
          );
          return;
        }

        // Batch transformer: handles thinking_delta, text_delta, AND
        // tool_use blocks (content_block_start with `type: tool_use`
        // + content_block_delta with `input_json_delta` +
        // content_block_stop). Pending tool calls accumulate their
        // input JSON across deltas; on stop the JSON is parsed, the
        // matchKey is checked against the input batch (so prompt drift
        // can't sneak in a result we can't attribute), and the result
        // is emitted as a `result` frame.
        //
        // We track a single pending tool call at a time. The API
        // permits parallel tool calls but the expected case is one per
        // turn; if upstream starts a second one before the first ends,
        // we flush the previous one first.
        const reader = upstream.body.getReader();
        let buf = '';
        type PendingTool = {
          id: string;
          name: string;
          inputJson: string;
        };
        let pending: PendingTool | null = null;

        const knownKeys = new Set(matches.map((m) => m.key));
        const seenKeys = new Set<string>();

        const flushTool = (tool: PendingTool) => {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(tool.inputJson || '{}');
          } catch (err) {
            console.warn(
              '[insights] tool input JSON parse failed:',
              err,
              tool.inputJson,
            );
            return;
          }
          const validated: MatchAnalysisToolInput | null =
            validateMatchAnalysisToolInput(parsed);
          if (!validated) {
            console.warn('[insights] dropping invalid tool input:', parsed);
            return;
          }
          if (!knownKeys.has(validated.matchKey)) {
            console.warn(
              `[insights] dropping tool result for unknown matchKey ${validated.matchKey}`,
            );
            return;
          }
          if (seenKeys.has(validated.matchKey)) {
            console.warn(
              `[insights] dropping duplicate tool result for matchKey ${validated.matchKey}`,
            );
            return;
          }
          seenKeys.add(validated.matchKey);
          const payload = JSON.stringify({ k: 'result', t: validated });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const eventType = parseSseEventType(frame);
            const data = parseSseData(frame);
            if (!data) continue;

            if (eventType === 'content_block_start') {
              try {
                const parsed = JSON.parse(data);
                const block = parsed?.content_block ?? {};
                if (
                  block.type === 'tool_use' &&
                  typeof block.id === 'string' &&
                  typeof block.name === 'string'
                ) {
                  // If a previous tool block is still pending (parallel
                  // tool_use), flush it before starting the new one.
                  if (pending) flushTool(pending);
                  pending = {
                    id: block.id,
                    name: block.name,
                    inputJson: '',
                  };
                  const framePayload = JSON.stringify({
                    k: 'tool_start',
                    t: block.name,
                  });
                  controller.enqueue(
                    encoder.encode(`data: ${framePayload}\n\n`),
                  );
                }
              } catch {
                // Ignore malformed frames.
              }
            } else if (eventType === 'content_block_delta') {
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.delta ?? {};

                // Forward `thinking_delta` and `text_delta` straight to
                // the client. These accumulate into the modal's
                // collapsible `ReasoningPanel` (thinkingBuf + textBuf)
                // — they don't drive UI state, just transparency into
                // what the model is doing between tool calls. Note: the
                // user wants the *per-market list* hidden during
                // processing (handled in AiAnalyseModal.tsx via the
                // compact AnalysingPanel); the model's reasoning text
                // stays surfaced in the optional collapsible panel.
                if (delta.type === 'thinking_delta') {
                  const text =
                    typeof delta.thinking === 'string' ? delta.thinking : '';
                  if (text.length > 0) {
                    const payload = JSON.stringify({ k: 'thinking', t: text });
                    controller.enqueue(
                      encoder.encode(`data: ${payload}\n\n`),
                    );
                  }
                } else if (delta.type === 'text_delta') {
                  const text = typeof delta.text === 'string' ? delta.text : '';
                  if (text.length > 0) {
                    const payload = JSON.stringify({ k: 'text', t: text });
                    controller.enqueue(
                      encoder.encode(`data: ${payload}\n\n`),
                    );
                  }
                } else if (
                  delta.type === 'input_json_delta' &&
                  pending &&
                  typeof delta.partial_json === 'string'
                ) {
                  // Tool-use payload fragments — accumulate into the
                  // pending tool call. Flushed as a `result` frame on
                  // `content_block_stop`.
                  pending.inputJson += delta.partial_json;
                }
              } catch {
                // Ignore malformed frames.
              }
            } else if (eventType === 'content_block_stop') {
              if (pending) {
                flushTool(pending);
                pending = null;
              }
            } else if (eventType === 'message_stop') {
              if (pending) {
                flushTool(pending);
                pending = null;
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } else if (eventType === 'error') {
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }
        }

        if (pending) {
          flushTool(pending);
          pending = null;
        }
        if (buf.trim().length > 0) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        console.error('[insights] batch stream failed:', err);
        emitErrorAndClose(
          controller,
          encoder,
          (err as Error).message ?? 'Stream failed',
        );
        return;
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed — fine.
        }
      }
    },
  });

  return new Response(transform, sseHeaders());
}

function emitErrorAndClose(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  message: string,
): void {
  controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ k: 'error', t: message })}\n\n`,
    ),
  );
  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
  controller.close();
}

function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

function parseSseEventType(frame: string): string {
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) return line.slice(6).trim();
  }
  return '';
}

function parseSseData(frame: string): string {
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) return line.slice(5).trim();
  }
  return '';
}

/** Test-only hook: clear the in-memory CMC cache. */
export const __resetCmcCache = () => {
  cmcCache = null;
};
