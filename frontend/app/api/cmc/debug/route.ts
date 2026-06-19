/**
 * `GET /api/cmc/debug` — diagnostic endpoint for the CoinMarketCap
 * integration. Always bypasses the in-memory cache and surfaces:
 *
 *   - whether `CMC_API_KEY` is populated in `process.env`
 *     (#1 cause of "all CmcContext fields are null" — dev server
 *     started before .env was updated, so the module-level read in
 *     `context/route.ts` is cached at startup with the empty string)
 *   - whether the upstream endpoints return real data on a fresh
 *     fetch (vs. an HTTP error / non-200)
 *
 * The two upstream endpoints each cost one CMC credit. Avoid hitting
 * this in a tight loop.
 */

import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RawFearGreed {
  data?: {
    value?: number;
    update_time?: string;
    value_classification?: string;
  };
}

interface RawGlobalMetrics {
  status?: { error_code?: number; error_message?: string };
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

async function safeFetchJson(
  url: string,
  key: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; statusText: string; body: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'X-CMC_PRO_API_KEY': key },
      signal,
    });
    const body = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, statusText: res.statusText, body: body.slice(0, 500) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      statusText: (err as Error).message ?? 'fetch failed',
      body: '',
    };
  }
}

export async function GET(req: NextRequest) {
  // Re-read at request time so we surface the *current* process env.
  // The module-level read in `context/route.ts` is cached at startup
  // — that's the actual bug if env was set after the dev server started.
  const runtimeKey = process.env.CMC_API_KEY ?? '';

  const fg = await safeFetchJson(
    'https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest',
    runtimeKey,
    req.signal,
  );
  const gm = await safeFetchJson(
    'https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest',
    runtimeKey,
    req.signal,
  );

  // Try to parse the bodies to extract the most useful fields.
  let fgParsed: RawFearGreed['data'] | null = null;
  let gmParsed: RawGlobalMetrics | null = null;
  try {
    if (fg.ok) fgParsed = (JSON.parse(fg.body) as RawFearGreed).data ?? null;
  } catch {
    // fall through
  }
  try {
    if (gm.ok) gmParsed = JSON.parse(gm.body) as RawGlobalMetrics;
  } catch {
    // fall through
  }

  let hint =
    'OK — env present, upstream returned 200, CmcContext fields should be populated.';
  if (!runtimeKey) {
    hint =
      'CMC_API_KEY is empty in process.env. Restart the dev server — Next.js loads .env at startup, so editing .env while the server is running does not take effect.';
  } else if (!fg.ok && !gm.ok) {
    hint = `Env present but BOTH upstream calls failed. Last status: fear-and-greed=${fg.status}, global-metrics=${gm.status}. Check the response bodies and your CMC plan entitlements.`;
  } else if (!fg.ok) {
    hint = `Env present; fear-and-geed failed (${fg.status}) but global-metrics succeeded.`;
  } else if (!gm.ok) {
    hint = `Env present; global-metrics failed (${gm.status}) but fear-and-greed succeeded. The free CMC plan may not include /v1/global-metrics/quotes/latest.`;
  }

  return Response.json(
    {
      runtime: {
        cmcApiKeyPresent: !!runtimeKey,
        cmcApiKeyLength: runtimeKey.length,
        cmcApiKeyPrefix: runtimeKey.slice(0, 4) || '(empty)',
      },
      fearGreed: {
        ok: fg.ok,
        status: fg.status,
        statusText: fg.statusText,
        value: fgParsed?.value ?? null,
        label: fgParsed?.value_classification ?? null,
        updatedAt: fgParsed?.update_time ?? null,
        bodyPreview: fg.ok ? '(parsed)' : fg.body.slice(0, 200),
      },
      globalMetrics: {
        ok: gm.ok,
        status: gm.status,
        statusText: gm.statusText,
        btcDominance24hChange: gmParsed?.data?.btc_dominance_24h_percentage_change ?? null,
        ethDominance24hChange: gmParsed?.data?.eth_dominance_24h_percentage_change ?? null,
        defi24hChange: gmParsed?.data?.quote?.USD?.defi_24h_percentage_change ?? null,
        stablecoin24hChange: gmParsed?.data?.quote?.USD?.stablecoin_24h_percentage_change ?? null,
        derivatives24hChange: gmParsed?.data?.quote?.USD?.derivatives_24h_percentage_change ?? null,
        totalMarketCapUsd: gmParsed?.data?.quote?.USD?.total_market_cap ?? null,
        totalVolume24hUsd: gmParsed?.data?.quote?.USD?.total_volume_24h ?? null,
        activeCryptocurrencies: gmParsed?.data?.active_cryptocurrencies ?? null,
        errorCode: gmParsed?.status?.error_code ?? null,
        errorMessage: gmParsed?.status?.error_message ?? null,
        bodyPreview: gm.ok ? '(parsed)' : gm.body.slice(0, 200),
      },
      hint,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
