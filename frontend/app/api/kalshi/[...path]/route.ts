/**
 * `GET /api/kalshi/<rest>` — same-origin proxy for Kalshi Trade API v2.
 *
 * Forwards every request verbatim to
 *   https://external-api.kalshi.com/trade-api/v2/<rest>
 * and relays the response back to the browser.
 *
 * # Why this exists
 *
 * Kalshi's `external-api.kalshi.com` does NOT send
 * `Access-Control-Allow-Origin`, so the browser blocks the call from
 * `https://www.deepbook.watch` (and any other origin) at the CORS
 * layer. The data is fully public and unauthenticated — we just need
 * a same-origin jump point so the request leaves the user's domain.
 *
 * # Endpoints used
 *
 *   GET /api/kalshi/markets?series_ticker=...&status=open&limit=200&cursor=...
 *   GET /api/kalshi/events/{event_ticker}
 *
 * The catch-all path keeps the route generic — any future Kalshi
 * endpoint we need (`/portfolio/*`, `/multivariate/*`, etc.) is just a
 * matter of adding a client URL. No code change here.
 *
 * # Caching
 *
 * 30s in-memory cache keyed by full upstream URL (including query).
 * Markets data moves slowly (a 5-min refresh cycle is normal for
 * binary markets); a 30s window absorbs bursts (5 users hitting the
 * page = 1 upstream call) without making the UI feel stale. Process-
 * local only — matches the same pattern as `/api/cmc/context`.
 *
 * # Stale-on-error
 *
 * If the upstream call fails AND a fresh-enough cached entry exists
 * (within the 30s window), serve the cached copy. The user sees
 * slightly stale data instead of a hard error — graceful degradation
 * for the live domain. The failure is still logged on the server so
 * ops can see it.
 *
 * # Headers
 *
 * `Cache-Control: no-store` on every response — Kalshi prices are
 * time-sensitive and we don't want a CDN or browser cache replaying
 * a quote from a minute ago.
 */

import type { NextRequest } from 'next/server';

const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2';
const CACHE_TTL_MS = 30_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CacheEntry {
  fetchedAt: number;
  body: string;
  contentType: string;
}

// Process-local cache. Same shape as `/api/cmc/context/route.ts` but
// keyed by upstream URL since this route serves many distinct URLs.
const cache = new Map<string, CacheEntry>();

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } },
): Promise<Response> {
  const rest = (params.path ?? []).join('/');
  if (!rest) {
    return new Response('Missing path', { status: 400 });
  }

  // Build the upstream URL by forward-porting the client's query
  // string verbatim. Using URLSearchParams in the client + reading
  // `nextUrl.searchParams` here means we round-trip every param
  // without a hardcoded allowlist.
  const upstreamUrl = new URL(`${KALSHI_BASE}/${rest}`);
  req.nextUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  const cacheKey = upstreamUrl.toString();
  const now = Date.now();
  const cached = cache.get(cacheKey);

  // Fresh cache hit — skip the upstream call.
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return new Response(cached.body, {
      status: 200,
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'no-store',
        'X-Kalshi-Proxy': 'HIT',
      },
    });
  }

  try {
    const upstreamRes = await fetch(upstreamUrl.toString(), {
      signal: req.signal,
      // Kalshi returns JSON; let the server pick the body encoding.
      headers: { Accept: 'application/json' },
    });

    const body = await upstreamRes.text();
    const contentType =
      upstreamRes.headers.get('content-type') ?? 'application/json';

    if (!upstreamRes.ok) {
      console.warn(
        `[kalshi-proxy] HTTP ${upstreamRes.status} ${upstreamRes.statusText} for ${upstreamUrl}`,
      );

      // Stale-on-error: if we have any cache entry, prefer it over a
      // hard 502 so the live domain doesn't break during a Kalshi
      // hiccup. Log it so ops can still see the failure.
      if (cached) {
        console.warn(
          `[kalshi-proxy] serving stale cache (${Math.round((now - cached.fetchedAt) / 1000)}s old) instead of ${upstreamRes.status}`,
        );
        return new Response(cached.body, {
          status: 200,
          headers: {
            'Content-Type': cached.contentType,
            'Cache-Control': 'no-store',
            'X-Kalshi-Proxy': 'STALE',
          },
        });
      }

      return new Response(body, {
        status: upstreamRes.status,
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
      });
    }

    // Only cache success — never cache a 4xx/5xx response.
    cache.set(cacheKey, { fetchedAt: now, body, contentType });

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Kalshi-Proxy': 'MISS',
      },
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      return new Response('Aborted', { status: 499 });
    }
    console.error('[kalshi-proxy] fetch failed:', err);

    // Stale-on-error for hard network failures too.
    if (cached) {
      console.warn(
        `[kalshi-proxy] serving stale cache (${Math.round((now - cached.fetchedAt) / 1000)}s old) after network error`,
      );
      return new Response(cached.body, {
        status: 200,
        headers: {
          'Content-Type': cached.contentType,
          'Cache-Control': 'no-store',
          'X-Kalshi-Proxy': 'STALE',
        },
      });
    }

    return new Response('Kalshi proxy fetch failed', { status: 502 });
  }
}
