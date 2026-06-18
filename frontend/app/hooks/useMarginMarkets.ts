/**
 * useMarginMarkets — Margin pool list, per network, driven by the DeepBook
 * indexer.
 *
 * Source of truth: `GET ${deepbookIndexer}/margin_managers_info` — returns one
 * row per *manager* (a pool can have many managers, one per user). We dedupe
 * by `deepbook_pool_id` so the UI gets one row per pool. The shape is mapped
 * to the existing `MarginMarket` contract (see `lib/marginMarkets.ts`) so the
 * downstream code (Simple/Advanced mode, LeveragedTradeModal) is unchanged.
 *
 * In parallel, we fetch `/get_pools` + `/ticker` + `/summary` + `/fees` from
 * the same indexer and enrich each margin-market row with spot-style data:
 *   - decimals (from /get_pools, by `base_asset_symbol` / `quote_asset_symbol`)
 *   - lastPrice / 24h change / 24h high-low / bid-ask (from /summary, fallback
 *     to /ticker for lastPrice)
 *   - 24h volume (from /ticker or /summary, prefers summary)
 *   - taker/maker fees + stakeRequired (from /fees, keyed by `BASE_QUOTE`)
 *   - isFrozen (from /ticker.isFrozen)
 *
 * The matching key is `market.replace('/', '_')` (e.g. `DEEP/SUI` → `DEEP_SUI`),
 * which is the same convention the spot hook uses.
 *
 * On fetch error we fall back to the per-network hardcoded list so the page
 * remains functional if the indexer is down. The hardcoded testnet list lives
 * in `lib/marginMarkets.ts` (renamed from `MARGIN_MARKETS` to
 * `HARDCODED_TESTNET_MARGIN_MARKETS`); mainnet has no hardcoded fallback
 * (intentionally — the indexer is the only source for mainnet margin pools).
 *
 * The hook is wallet-free — the indexer is a public REST endpoint, no
 * signer / RPC connection needed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNetworkConfig } from './useNetworkConfig';
import { useNetwork } from '../context/NetworkContext';
import {
  HARDCODED_TESTNET_MARGIN_MARKETS,
  type MarginMarket,
} from '../lib/marginMarkets';

export { type MarginMarket } from '../lib/marginMarkets';

// ─── Indexer response shapes ───────────────────────────────────────────────

interface MarginManagerInfoRow {
  base_asset_id: string;
  base_asset_symbol: string;
  quote_asset_id: string;
  quote_asset_symbol: string;
  deepbook_pool_id: string;
  base_margin_pool_id: string;
  quote_margin_pool_id: string;
  margin_manager_id: string;
}

interface PoolResponse {
  pool_id: string;
  pool_name: string;
  base_asset_id: string;
  base_asset_decimals: number;
  base_asset_symbol: string;
  quote_asset_id: string;
  quote_asset_decimals: number;
  quote_asset_symbol: string;
}

interface TickerResponse {
  [poolName: string]: {
    last_price: number;
    base_volume: number;
    quote_volume: number;
    isFrozen: number;
  };
}

interface SummaryItem {
  trading_pairs: string;
  base_currency: string;
  quote_currency: string;
  last_price: number;
  base_volume: number;
  quote_volume: number;
  price_change_percent_24h: number;
  lowest_price_24h: number;
  highest_price_24h: number;
  lowest_ask: number;
  highest_bid: number;
}

interface FeesResponse {
  [poolName: string]: {
    pool_id: string;
    taker_fee: number;
    maker_fee: number;
    stake_required: number;
  };
}

async function fetchPools(url: string): Promise<PoolResponse[]> {
  const r = await fetch(`${url}/get_pools`);
  if (!r.ok) throw new Error(`get_pools ${r.status}`);
  return r.json();
}

async function fetchTicker(url: string): Promise<TickerResponse> {
  const r = await fetch(`${url}/ticker`);
  if (!r.ok) throw new Error(`ticker ${r.status}`);
  return r.json();
}

async function fetchSummary(url: string): Promise<SummaryItem[]> {
  const r = await fetch(`${url}/summary`);
  if (!r.ok) throw new Error(`summary ${r.status}`);
  return r.json();
}

async function fetchFees(url: string): Promise<FeesResponse> {
  const r = await fetch(`${url}/fees`);
  if (!r.ok) throw new Error(`fees ${r.status}`);
  return r.json();
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useMarginMarkets(refreshInterval = 30_000) {
  const cfg = useNetworkConfig();
  const { network } = useNetwork();
  const indexerUrl = cfg.deepbookIndexer;

  const [markets, setMarkets] = useState<MarginMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromIndexer, setFromIndexer] = useState(false);

  const fallback = useMemo<MarginMarket[]>(
    () => (network === 'testnet' ? HARDCODED_TESTNET_MARGIN_MARKETS : []),
    [network],
  );

  const load = useCallback(async () => {
    console.log('[useMarginMarkets] loading from', indexerUrl, 'network:', network);
    setLoading(true);
    try {
      // 1. Margin-pool list — the unique-pools source.
      const marginUrl = `${indexerUrl}/margin_managers_info`;
      console.log('[useMarginMarkets] GET', marginUrl);
      const marginRes = await fetch(marginUrl);
      console.log('[useMarginMarkets] margin_managers_info status', marginRes.status, marginRes.statusText);
      if (!marginRes.ok) throw new Error(`margin_managers_info returned ${marginRes.status}`);
      const marginRows: MarginManagerInfoRow[] = await marginRes.json();
      console.log('[useMarginMarkets] margin rows:', marginRows.length);

      // 2. Enrichment data, in parallel. Any of these failing is non-fatal —
      //    we still return a markets list, just without that data.
      const [poolsData, tickerData, summaryData, feesData] = await Promise.all([
        fetchPools(indexerUrl).catch((e) => {
          console.warn('[useMarginMarkets] /get_pools failed', e);
          return [] as PoolResponse[];
        }),
        fetchTicker(indexerUrl).catch((e) => {
          console.warn('[useMarginMarkets] /ticker failed', e);
          return {} as TickerResponse;
        }),
        fetchSummary(indexerUrl).catch((e) => {
          console.warn('[useMarginMarkets] /summary failed', e);
          return [] as SummaryItem[];
        }),
        fetchFees(indexerUrl).catch((e) => {
          console.warn('[useMarginMarkets] /fees failed', e);
          return {} as FeesResponse;
        }),
      ]);

      // Indexer lookups keyed by pool name (BASE_QUOTE).
      const poolByName = new Map<string, PoolResponse>();
      for (const p of poolsData) poolByName.set(p.pool_name, p);

      const summaryByPair = new Map<string, SummaryItem>();
      for (const s of summaryData) summaryByPair.set(s.trading_pairs, s);

      // Dedup margin rows by deepbook_pool_id — many managers share one pool.
      const seen = new Set<string>();
      const deduped: MarginMarket[] = [];
      for (const r of marginRows) {
        if (!r?.deepbook_pool_id || seen.has(r.deepbook_pool_id)) continue;
        seen.add(r.deepbook_pool_id);
        const market = `${r.base_asset_symbol}/${r.quote_asset_symbol}`;
        const poolName = market.replace('/', '_');

        const poolMeta = poolByName.get(poolName);
        const ticker = tickerData[poolName];
        const summary = summaryByPair.get(poolName);
        const fee = feesData[poolName];

        deduped.push({
          market,
          baseAssetSymbol: r.base_asset_symbol,
          quoteAssetSymbol: r.quote_asset_symbol,
          baseAssetId: r.base_asset_id,
          quoteAssetId: r.quote_asset_id,
          deepbookPoolId: r.deepbook_pool_id,
          baseMarginPoolId: r.base_margin_pool_id,
          quoteMarginPoolId: r.quote_margin_pool_id,
          // decimals — prefer /get_pools, fall back to ticker/summary or
          // unknown (UI will render `—`).
          baseAssetDecimals: poolMeta?.base_asset_decimals,
          quoteAssetDecimals: poolMeta?.quote_asset_decimals,
          // price — summary has the most recent snapshot.
          lastPrice: summary?.last_price ?? ticker?.last_price,
          change24h: summary?.price_change_percent_24h,
          baseVolume: summary?.base_volume ?? ticker?.base_volume,
          quoteVolume: summary?.quote_volume ?? ticker?.quote_volume,
          highestPrice24h: summary?.highest_price_24h,
          lowestPrice24h: summary?.lowest_price_24h,
          lowestAsk: summary?.lowest_ask,
          highestBid: summary?.highest_bid,
          // fees + stake — only available from /fees.
          takerFee: fee?.taker_fee,
          makerFee: fee?.maker_fee,
          stakeRequired: fee?.stake_required,
          // isFrozen — only available from /ticker.
          isFrozen: ticker?.isFrozen === 1,
        });
      }
      console.log('[useMarginMarkets] after dedup+enrich:', deduped.length, 'markets');

      // Sort alphabetically so the dropdown is stable across networks.
      deduped.sort((a, b) => a.market.localeCompare(b.market));

      setMarkets(deduped);
      setFromIndexer(true);
      setError(null);
    } catch (e: any) {
      // Fall back to hardcoded. Don't surface a hard error — the UI will show
      // the fallback list, which is still useful (and matches what was shown
      // before the indexer integration shipped).
      console.warn('[useMarginMarkets] indexer fetch failed, using fallback', e);
      console.log('[useMarginMarkets] fallback markets:', fallback.length);
      setMarkets(fallback);
      setFromIndexer(false);
      setError(e?.message ?? 'Indexer unavailable');
    } finally {
      setLoading(false);
    }
  }, [indexerUrl, fallback, network]);

  useEffect(() => {
    load();
    const id = setInterval(load, refreshInterval);
    return () => clearInterval(id);
  }, [load, refreshInterval]);

  return {
    markets,
    loading,
    error,
    /** True if the current `markets` came from the live indexer (vs. fallback). */
    fromIndexer,
    refetch: load,
  };
}
