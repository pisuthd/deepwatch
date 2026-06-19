/**
 * `GET /api/cmc/context` — server-proxied CoinMarketCap macro snapshot.
 *
 * Fetches two upstream endpoints and combines them into a single
 * `CmcContext` payload used as backdrop for the AI batch call:
 *
 *  1. `https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest`
 *     → primary sentiment signal (Fear & Greed value + classification)
 *
 *  2. `https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest`
 *     → 24h sector trend (DeFi %, stablecoin %, derivatives %, BTC/ETH
 *       dominance 24h change) + backdrop (total market cap, total 24h
 *       volume, active cryptocurrencies).
 *
 * **Why these two only:** per user direction, absolute BTC dominance
 * is essentially constant on a 24h horizon (always in the 50–60%
 * band) and is not informative on its own. Sentiment + 24h sector
 * trend are what the model can act on. The 24h *change* in dominance
 * is what matters (negative = altcoin gaining share = altcoin-season
 * signal); the absolute value is not exposed.
 *
 * **Caching:** process-local in-memory `Map` keyed by UTC day, 60s
 * TTL, max 1 entry. Rationale: clicking "Analyse" on 5 rows in a
 * minute would otherwise fire 5 upstream CMC calls. 60s means a flurry
 * costs one roundtrip and stays well under the CMC free-tier rate
 * limit (10K calls/month, 30/min). Process-local only — good enough
 * for one server instance; swap to Redis/file cache when the
 * deployment goes multi-instance.
 *
 * **Environment:**
 *   `CMC_API_KEY` — server-only, sent as `X-CMC_PRO_API_KEY`. Never
 *                   bundled to the client.
 *
 * The AI route imports `CmcContext` via `import type` so the
 * response shape stays in sync with the prompt-injection code.
 */

import type { NextRequest } from 'next/server';
import type { CmcContext } from '../../../lib/match-analyses';

const CMC_API_KEY = process.env.CMC_API_KEY ?? '';
const CMC_BASE = 'https://pro-api.coinmarketcap.com';
const CACHE_TTL_MS = 60_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CachedContext {
  fetchedAt: number;
  context: CmcContext;
}

let cache: CachedContext | null = null;

function isCacheFresh(c: CachedContext | null): c is CachedContext {
  return !!c && Date.now() - c.fetchedAt < CACHE_TTL_MS;
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
    btc_dominance?: number;
    eth_dominance?: number;
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
    console.warn('[cmc] fetchFearGreed: CMC_API_KEY is empty (check that the dev server was restarted after .env was updated; module-level env reads are cached at startup)');
    return { value: null, label: null, updatedAt: null };
  }
  try {
    const res = await fetch(`${CMC_BASE}/v3/fear-and-greed/latest`, {
      headers: { 'X-CMC_PRO_API_KEY': CMC_API_KEY },
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[cmc] fear-and-greed HTTP ${res.status} ${res.statusText} — body: ${body.slice(0, 200)}`,
      );
      return { value: null, label: null, updatedAt: null };
    }
    const json = (await res.json()) as RawFearGreed;
    return {
      value: typeof json.data?.value === 'number' ? json.data.value : null,
      label: typeof json.data?.value_classification === 'string'
        ? json.data.value_classification
        : null,
      updatedAt: typeof json.data?.update_time === 'string'
        ? json.data.update_time
        : null,
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
    console.warn('[cmc] fetchGlobalMetrics: CMC_API_KEY is empty (check that the dev server was restarted after .env was updated; module-level env reads are cached at startup)');
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
      const body = await res.text().catch(() => '');
      console.warn(
        `[cmc] global-metrics HTTP ${res.status} ${res.statusText} — body: ${body.slice(0, 200)}`,
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
      btcDominance24hChange: typeof json.data?.btc_dominance_24h_percentage_change === 'number'
        ? json.data.btc_dominance_24h_percentage_change
        : null,
      ethDominance24hChange: typeof json.data?.eth_dominance_24h_percentage_change === 'number'
        ? json.data.eth_dominance_24h_percentage_change
        : null,
      defi24hChange: typeof usd?.defi_24h_percentage_change === 'number'
        ? usd.defi_24h_percentage_change
        : null,
      stablecoin24hChange: typeof usd?.stablecoin_24h_percentage_change === 'number'
        ? usd.stablecoin_24h_percentage_change
        : null,
      derivatives24hChange: typeof usd?.derivatives_24h_percentage_change === 'number'
        ? usd.derivatives_24h_percentage_change
        : null,
      totalMarketCapUsd: typeof usd?.total_market_cap === 'number'
        ? usd.total_market_cap
        : null,
      totalVolume24hUsd: typeof usd?.total_volume_24h === 'number'
        ? usd.total_volume_24h
        : null,
      activeCryptocurrencies: typeof json.data?.active_cryptocurrencies === 'number'
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

async function buildContext(signal: AbortSignal): Promise<CmcContext> {
  // Fire both upstream calls in parallel — they're independent.
  const [fg, gm] = await Promise.all([
    fetchFearGreed(signal),
    fetchGlobalMetrics(signal),
  ]);
  return {
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
}

export async function GET(req: NextRequest) {
  if (!CMC_API_KEY) {
    return new Response(
      'CMC_API_KEY is not configured. Set it in your server environment.',
      { status: 503 },
    );
  }
  if (isCacheFresh(cache)) {
    return Response.json(cache.context, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  try {
    const context = await buildContext(req.signal);
    cache = { fetchedAt: context.fetchedAt, context };
    return Response.json(context, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      return new Response('Aborted', { status: 499 });
    }
    console.error('[cmc] build context failed:', err);
    return new Response('CMC fetch failed', { status: 502 });
  }
}

/** Test-only hook: clear the in-memory cache. Not exported from the
 *  module's public surface. */
export const __resetCache = () => {
  cache = null;
};
