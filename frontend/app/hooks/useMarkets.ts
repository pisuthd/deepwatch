/**
 * useMarkets - List all active markets with odds
 * 
 * Mirrors the walkthrough script: list-oracles.js + fetch-single-oracle.js
 */

import { useState, useEffect, useCallback } from 'react'

// ─── Constants (same as walkthrough scripts) ────────────────────────────────

const SERVER = 'https://predict-server.testnet.mystenlabs.com'
const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a'
const PRICE_SCALE = 1e9
const SVI_SCALE = 1e8
const RHO_SCALE = 1e9
const BET_SIZE = 1

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SVIParams {
  a: number; b: number; rho: number; m: number; sigma: number
}

export interface Oracle {
  oracle_id: string
  expiry: number
  min_strike: number
  tick_size: number
  status: 'active' | 'settled' | 'pending'
  underlying_asset?: string
  settlement_price?: number
  settled_at?: number
}

export interface OracleState {
  latest_price?: { spot: number; forward: number }
  latest_svi?: SVIParams
}

export interface Odds {
  upProb: number
  downProb: number
  strikeK?: number
  upPayout: number
  downPayout: number
}

export interface RangeOdds {
  lowerStrike: number
  upperStrike: number
  rangeWidth: number
  inRangeProb: number
  outRangeProb: number
  inRangePayout: number
  outRangePayout: number
}

export interface Market {
  oracle_id: string
  name: string        // e.g., "BTC", "ETH" - derived from market data
  asset: string       // asset symbol
  expiryMs: number
  spot: number
  forward: number
  svi: SVIParams | null
  odds: Odds | null
  status: 'active' | 'settled' | 'pending'
  minStrike: number
  tickSize: number
  settlementPrice?: number  // For settled markets
  settledAt?: number        // For settled markets (timestamp)
}

export interface VaultSummary {
  vault_value: number
  available_liquidity: number
}

// ─── Black-76 + SVI Formulas (same as utils.ts) ───────────────────────────

function normCDF(x: number): number {
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

function sviVol(K: number, F: number, T: number, svi: SVIParams): number {
  if (T <= 0) return svi.sigma / SVI_SCALE
  const a = svi.a / SVI_SCALE
  const b = svi.b / SVI_SCALE
  const rho = svi.rho / RHO_SCALE
  const m = svi.m / SVI_SCALE
  const sig = svi.sigma / SVI_SCALE
  const k = Math.log(K / F)
  const w = a + b * (rho * (k - m) + Math.sqrt((k - m) ** 2 + sig ** 2))
  return w > 0 ? Math.sqrt(w / T) : sig
}

function binaryUpProb(F: number, K: number, T: number, vol: number): number {
  if (T <= 0 || vol <= 0) return F > K ? 1 : 0
  const d2 = (Math.log(F / K) - 0.5 * vol ** 2 * T) / (vol * Math.sqrt(T))
  return normCDF(d2)
}

function calcOdds(forward: number, spot: number, svi: SVIParams, expiryMs: number, minStrike: number, tickSize: number): Odds | null {
  if (!svi || !forward || forward <= 0) return null

  const F = forward / PRICE_SCALE
  const spotUSD = spot / PRICE_SCALE
  const T = Math.max(0, (expiryMs - Date.now()) / (365.25 * 24 * 3600 * 1000))
  const K = Math.ceil((spotUSD - minStrike) / tickSize) * tickSize + minStrike

  const volAtm = sviVol(K, F, T, svi)
  const upProb = binaryUpProb(F, K, T, volAtm)
  const downProb = 1 - upProb

  return {
    upProb,
    downProb,
    strikeK: K,
    upPayout: upProb > 0.01 ? parseFloat((BET_SIZE / upProb).toFixed(2)) : 0,
    downPayout: downProb > 0.01 ? parseFloat((BET_SIZE / downProb).toFixed(2)) : 0,
  }
}

// ─── API Fetchers ────────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function listMarkets(signal?: AbortSignal): Promise<Market[]> {
  const oracles = await fetchJSON<Oracle[]>(`${SERVER}/predicts/${PREDICT_ID}/oracles`, signal)

  // Settled markets are excluded entirely — they don't need live data and
  // are not surfaced in the UI.
  const marketsNeedingState = oracles.filter(o => o.status === 'active' || o.status === 'pending')

  const activeMarketList = await Promise.all(
    marketsNeedingState.map(async (oracle) => {
      try {
        const state = await fetchJSON<OracleState>(`${SERVER}/oracles/${oracle.oracle_id}/state`, signal)

        // For now, hardcode to BTC since all current markets are BTC
        // TODO: Fetch asset from API or metadata
        const asset = 'BTC'
        const minStrikeUSD = oracle.min_strike / PRICE_SCALE

        const market: Market = {
          oracle_id: oracle.oracle_id,
          name: asset,
          asset: asset,
          expiryMs: oracle.expiry,
          spot: state.latest_price?.spot ?? 0,
          forward: state.latest_price?.forward ?? 0,
          svi: state.latest_svi ?? null,
          odds: null,
          status: oracle.status,
          minStrike: minStrikeUSD,
          tickSize: oracle.tick_size / PRICE_SCALE,
        }
        market.odds = calcOdds(market.forward, market.spot, market.svi!, market.expiryMs, market.minStrike, market.tickSize)
        return market
      } catch {
        return null
      }
    })
  )

  // Drop oracles that have already expired or are about to — anything
  // inside the 30s window has unreliable SVI/forward data (T → 0 makes
  // Black-76 collapse to the fallback) and can't be traded anyway.
  const EXPIRY_BUFFER_MS = 30_000
  const nowMs = Date.now()
  return activeMarketList
    .filter((m): m is Market => m !== null)
    .filter((m) => m.expiryMs >= nowMs + EXPIRY_BUFFER_MS)
    .sort((a, b) => a.expiryMs - b.expiryMs)
}

export async function fetchVault(signal?: AbortSignal): Promise<VaultSummary | null> {
  try {
    return await fetchJSON<VaultSummary>(`${SERVER}/predicts/${PREDICT_ID}/vault/summary`, signal)
  } catch {
    return null
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useMarkets(refreshInterval = 30_000) {
  const [markets, setMarkets] = useState<Market[]>([])
  const [vault, setVault] = useState<VaultSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [marketsData, vaultData] = await Promise.all([
        listMarkets(signal),
        fetchVault(signal),
      ])
      if (signal?.aborted) return
      setMarkets(marketsData)
      setVault(vaultData)
      setError(null)
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) return
      setError(err instanceof Error ? err.message : 'Failed to load markets')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    load(ctrl.signal)
    const interval = setInterval(() => load(ctrl.signal), refreshInterval)
    return () => {
      ctrl.abort()
      clearInterval(interval)
    }
  }, [load, refreshInterval])

  return { markets, vault, loading, error, refetch: load }
}