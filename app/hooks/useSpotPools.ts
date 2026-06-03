/**
 * useSpotPools - Fetch and manage DeepBookV3 Spot pools
 *
 * Fetches real-time data from the DeepBookV3 Indexer for the active network
 * (driven by `useNetwork()`). Indexer URL comes from `useNetworkConfig()`.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNetworkConfig } from './useNetworkConfig'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpotPool {
  poolId: string
  poolName: string
  baseAsset: string
  baseAssetId: string
  baseAssetDecimals: number
  quoteAsset: string
  quoteAssetId: string
  quoteAssetDecimals: number
  minSize: number
  lotSize: number
  tickSize: number
  // Ticker data
  lastPrice?: number
  baseVolume?: number
  quoteVolume?: number
  change24h?: number
  isFrozen?: boolean
  // Summary data
  lowestPrice24h?: number
  highestPrice24h?: number
  lowestAsk?: number
  highestBid?: number
}

export interface OrderBookLevel {
  price: number
  quantity: number
  total: number
}

export interface OrderBook {
  timestamp: string
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  spread: number
  spreadPercent: number
  midPrice: number
}

// ─── API Functions ────────────────────────────────────────────────────────────

interface PoolResponse {
  pool_id: string
  pool_name: string
  base_asset_id: string
  base_asset_decimals: number
  base_asset_symbol: string
  base_asset_name: string
  quote_asset_id: string
  quote_asset_decimals: number
  quote_asset_symbol: string
  quote_asset_name: string
  min_size: number
  lot_size: number
  tick_size: number
}

interface TickerResponse {
  [pair: string]: {
    last_price: number
    base_volume: number
    quote_volume: number
    isFrozen: number
  }
}

interface SummaryItem {
  trading_pairs: string
  base_currency: string
  quote_currency: string
  last_price: number
  base_volume: number
  quote_volume: number
  price_change_percent_24h: number
  lowest_price_24h: number
  highest_price_24h: number
  lowest_ask: number
  highest_bid: number
}

interface OrderBookResponse {
  timestamp: string
  bids: [string, string][]
  asks: [string, string][]
}

async function fetchPools(indexerUrl: string): Promise<PoolResponse[]> {
  const response = await fetch(`${indexerUrl}/get_pools`)
  if (!response.ok) throw new Error('Failed to fetch pools')
  return response.json()
}

async function fetchTicker(indexerUrl: string): Promise<TickerResponse> {
  const response = await fetch(`${indexerUrl}/ticker`)
  if (!response.ok) throw new Error('Failed to fetch ticker')
  return response.json()
}

async function fetchSummary(indexerUrl: string): Promise<SummaryItem[]> {
  const response = await fetch(`${indexerUrl}/summary`)
  if (!response.ok) throw new Error('Failed to fetch summary')
  return response.json()
}

async function fetchOrderBook(indexerUrl: string, poolName: string, depth = 20): Promise<OrderBookResponse> {
  const response = await fetch(`${indexerUrl}/orderbook/${poolName}?level=2&depth=${depth}`)
  if (!response.ok) throw new Error('Failed to fetch order book')
  return response.json()
}

async function fetchOHLCV(indexerUrl: string, poolName: string, interval = '1h', limit = 100): Promise<OHLCVData> {
  const response = await fetch(`${indexerUrl}/ohclv/${poolName}?interval=${interval}&limit=${limit}`)
  if (!response.ok) throw new Error('Failed to fetch OHLCV data')
  return response.json()
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OHLCVCandle {
  time: number // Unix timestamp in seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface OHLCVData {
  candles: [number, number, number, number, number, number][] // [timestamp, open, high, low, close, volume]
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useSpotPools(refreshInterval = 5_000) {
  const cfg = useNetworkConfig();
  const indexerUrl = cfg.deepbookIndexer;
  const [pools, setPools] = useState<SpotPool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      // Fetch pools, ticker data, and summary data in parallel
      const [poolsData, tickerData, summaryData] = await Promise.all([
        fetchPools(indexerUrl),
        fetchTicker(indexerUrl),
        fetchSummary(indexerUrl)
      ])

      // Create a map of summary data keyed by trading_pairs (BASE_QUOTE format)
      const summaryMap = new Map<string, SummaryItem>()
      summaryData.forEach(item => {
        summaryMap.set(item.trading_pairs, item)
      })

      // Map pools with ticker data and summary data
      const mappedPools: SpotPool[] = poolsData.map(pool => {
        const ticker = tickerData[pool.pool_name]
        // Try to find summary data using different formats
        const formats = [
          pool.pool_name, // e.g., "DEEP_SUI"
          `${pool.base_asset_symbol}_${pool.quote_asset_symbol}`, // e.g., "DEEP_SUI"
        ]
        
        let summary: SummaryItem | undefined
        for (const format of formats) {
          summary = summaryMap.get(format)
          if (summary) break
        }

        return {
          poolId: pool.pool_id,
          poolName: pool.pool_name,
          baseAsset: pool.base_asset_symbol,
          baseAssetId: pool.base_asset_id,
          baseAssetDecimals: pool.base_asset_decimals,
          quoteAsset: pool.quote_asset_symbol,
          quoteAssetId: pool.quote_asset_id,
          quoteAssetDecimals: pool.quote_asset_decimals,
          minSize: pool.min_size,
          lotSize: pool.lot_size,
          tickSize: pool.tick_size,
          // Use summary data if available, otherwise ticker data
          lastPrice: summary?.last_price ?? ticker?.last_price ?? 0,
          baseVolume: summary?.base_volume ?? ticker?.base_volume ?? 0,
          quoteVolume: summary?.quote_volume ?? ticker?.quote_volume ?? 0,
          change24h: summary?.price_change_percent_24h,
          lowestPrice24h: summary?.lowest_price_24h,
          highestPrice24h: summary?.highest_price_24h,
          lowestAsk: summary?.lowest_ask,
          highestBid: summary?.highest_bid,
          isFrozen: ticker?.isFrozen === 1,
        }
      }).reverse()
 
      setPools(mappedPools
        .filter(p =>
          p.poolName === 'DEEP_SUI' || p.poolName === 'SUI_DBUSDC' ||
          ((p.lastPrice ?? 0) > 0 && !p.isFrozen)
        )
        .sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0))
      )
      setError(null)
    } catch (err) {
      console.error('Error fetching pools:', err)
      setError(err instanceof Error ? err.message : 'Failed to load pools')
    } finally {
      setLoading(false)
    }
  }, [indexerUrl])

  useEffect(() => {
    load()
    const interval = setInterval(load, refreshInterval)
    return () => clearInterval(interval)
  }, [load, refreshInterval])

  // Get order book for a specific pool
  const getOrderBook = useCallback(async (poolName: string): Promise<OrderBook | null> => {
    try {
      const data = await fetchOrderBook(indexerUrl, poolName, 20)

      // Parse bids and asks
      let bidTotal = 0
      let askTotal = 0

      const bids: OrderBookLevel[] = data.bids.map(([price, qty]) => {
        const priceNum = parseFloat(price)
        const qtyNum = parseFloat(qty)
        bidTotal += qtyNum
        return { price: priceNum, quantity: qtyNum, total: bidTotal }
      })

      const asks: OrderBookLevel[] = data.asks.map(([price, qty]) => {
        const priceNum = parseFloat(price)
        const qtyNum = parseFloat(qty)
        askTotal += qtyNum
        return { price: priceNum, quantity: qtyNum, total: askTotal }
      })

      // Calculate spread
      const bestBid = bids[0]?.price ?? 0
      const bestAsk = asks[0]?.price ?? 0
      const spread = bestAsk - bestBid
      const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0
      const midPrice = (bestBid + bestAsk) / 2

      return {
        timestamp: data.timestamp,
        bids,
        asks,
        spread,
        spreadPercent,
        midPrice,
      }
    } catch (err) {
      console.error('Error fetching order book:', err)
      return null
    }
  }, [indexerUrl])

  // Get pool by name
  const getPoolByName = useCallback((poolName: string) => {
    return pools.find(p => p.poolName === poolName)
  }, [pools])

  // Get pool by asset pair
  const getPoolByAssets = useCallback((baseAsset: string, quoteAsset: string) => {
    return pools.find(p => p.baseAsset === baseAsset && p.quoteAsset === quoteAsset)
  }, [pools])

  // Get OHLCV data for a specific pool
  const getOHLCV = useCallback(async (poolName: string, interval = '1h', limit = 100): Promise<OHLCVCandle[]> => {
    try {
      const data = await fetchOHLCV(indexerUrl, poolName, interval, limit)
      // Convert array format to objects
      return data.candles.map(([time, open, high, low, close, volume]) => ({
        time,
        open,
        high,
        low,
        close,
        volume,
      }))
    } catch (err) {
      console.error('Error fetching OHLCV data:', err)
      return []
    }
  }, [indexerUrl])

  return {
    pools,
    loading,
    error,
    refetch: load,
    getOrderBook,
    getOHLCV,
    getPoolByName,
    getPoolByAssets,
    INDEXER_URL: indexerUrl,
  }
}
