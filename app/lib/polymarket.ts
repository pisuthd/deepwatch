/**
 * Tatum prediction-markets client.
 *
 * Wraps `GET /v4/data/prediction/markets` so the Polymarket card on the
 * Add Insight page can run a debounced search and list candidate markets
 * the user might want to embed. The same `x-api-key` header and base URL
 * as the Walrus helpers in `./tatum.ts` — we re-use `TatumApiError` and
 * `describeTatumError` from there.
 *
 * The response is `{ data: PolymarketMarketRaw[] }` for the prediction
 * endpoint (matching the user's curl example). We accept both the
 * unwrapped-array and `{ data: [...] }` shapes for robustness.
 */

import { TATUM_BASE_URL, TatumApiError, describeTatumError } from './tatum';

export interface PolymarketSearchOptions {
  /** Free-text search (mapped to the `search` query param). */
  search?: string;
  /** Tag filter, e.g. "up-or-down". */
  tag?: string;
  platform?: 'polymarket' | 'kalshi';
  status?: 'active' | 'closed' | 'resolved' | 'all';
  sort?: 'newest' | 'volume' | 'liquidity' | 'endingSoon';
  /** 1–100, default 50. */
  limit?: number;
  /** ISO date — only markets closing before this are returned. */
  endingBefore?: string;
}

export interface PolymarketMarketRaw {
  id: string;
  platform: 'polymarket' | 'kalshi' | string;
  eventId?: string;
  question: string;
  description?: string;
  category?: string;
  tags?: string[];
  imageUrl?: string;
  status: string;
  openTime?: string;
  closeTime?: string;
  settleTime?: string | null;
  outcomes: Array<{ name: string; price: number; tokenId?: string }>;
  volume: number;
  volumeUnit?: string;
  liquidity: number;
  resolution?: string | null;
  source?: { platform: string; platformId: string; url: string };
  createdAt?: string;
}

export async function searchPredictionMarkets(
  apiKey: string,
  options: PolymarketSearchOptions = {},
): Promise<PolymarketMarketRaw[]> {
  if (!apiKey) throw new Error('Tatum API key is required');
  const params = new URLSearchParams();
  params.set('platform', options.platform ?? 'polymarket');
  if (options.status) params.set('status', options.status);
  if (options.tag) params.set('tag', options.tag);
  if (options.search) params.set('search', options.search);
  if (options.endingBefore) params.set('endingBefore', options.endingBefore);
  if (options.sort) params.set('sort', options.sort);
  if (options.limit) params.set('limit', String(options.limit));

  const res = await fetch(`${TATUM_BASE_URL}/v4/data/prediction/markets?${params}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new TatumApiError(
      res.status,
      body,
      `Market search failed (${res.status}): ${describeTatumError(body) ?? res.statusText}`,
    );
  }
  const data = await res.json();
  const items = Array.isArray(data) ? data : data?.data;
  return Array.isArray(items) ? (items as PolymarketMarketRaw[]) : [];
}
