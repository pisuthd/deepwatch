/**
 * useMarketPrices - Get price history for a market
 * 
 * Mirrors the walkthrough script: fetch-single-oracle.js (prices section)
 */

import { useState, useEffect, useCallback } from 'react'

// ─── Constants ──────────────────────────────────────────────────────────────

const SERVER = 'https://predict-server.testnet.mystenlabs.com'
const PRICE_SCALE = 1e9

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PricePoint {
  time: number    // timestamp in ms
  price: number  // forward price in USD (already divided by PRICE_SCALE)
  spot: number    // spot price in USD
  digest: string
  checkpoint: number
}

export interface PriceHistory {
  oracle_id: string
  prices: PricePoint[]
  latestPrice: number
  latestSpot: number
}

// ─── API Fetcher ────────────────────────────────────────────────────────────

interface RawPriceEvent {
  digest: string
  checkpoint: number
  tx_index: number
  event_index: number
  spot: number
  forward: number
  onchain_timestamp: number
}

async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getMarketPrices(
  oracleId: string,
  limit = 60,
  signal?: AbortSignal
): Promise<PriceHistory | null> {
  try {

    const raw = await fetchJSON<RawPriceEvent[]>(
      `${SERVER}/oracles/${oracleId}/prices?limit=${limit}`,
      signal
    )

    if (!raw || !Array.isArray(raw)) return null

    const prices: PricePoint[] = raw
      .map(p => ({
        time: p.onchain_timestamp,
        price: p.forward / PRICE_SCALE,
        spot: p.spot / PRICE_SCALE,
        digest: p.digest,
        checkpoint: p.checkpoint,
      }))
      .sort((a, b) => a.time - b.time)

    const latestPrice = prices.length > 0
      ? prices[prices.length - 1].price
      : 0
    const latestSpot = prices.length > 0
      ? prices[prices.length - 1].spot
      : 0

    return {
      oracle_id: oracleId,
      prices,
      latestPrice,
      latestSpot,
    }
  } catch {
    return null
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useMarketPrices(
  oracleId: string | null,
  limit = 60,
  refreshInterval = 15_000  // 15s — chart data is slow-changing
) {
  const [history, setHistory] = useState<PriceHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!oracleId) {
      if (!signal?.aborted) {
        setHistory(null)
        setLoading(false)
      }
      return
    }

    try {
      const data = await getMarketPrices(oracleId, limit, signal)
      if (signal?.aborted) return
      if (data) {
        setHistory(data)
        setError(null)
      } else {
        setError('Failed to fetch price history')
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) return
      setError(err instanceof Error ? err.message : 'Failed to load prices')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [oracleId, limit])

  useEffect(() => {
    const ctrl = new AbortController()
    load(ctrl.signal)
    if (!oracleId) return

    const interval = setInterval(() => load(ctrl.signal), refreshInterval)
    return () => {
      ctrl.abort()
      clearInterval(interval)
    }
  }, [load, oracleId, refreshInterval])

  return { history, loading, error, refetch: load }
}