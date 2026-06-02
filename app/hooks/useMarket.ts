/**
 * useMarket - Get single market details
 *
 * Mirrors the walkthrough script: fetch-single-oracle.js
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
  rho_negative?: boolean; m_negative?: boolean
}

export interface Oracle {
  oracle_id: string
  expiry: number
  min_strike: number
  tick_size: number
  status: 'active' | 'settled' | 'pending'
  underlying_asset?: string
}

export interface OracleState {
  oracle: Oracle
  latest_price?: { spot: number; forward: number; digest: string; checkpoint: number }
  latest_svi?: SVIParams
  ask_bounds?: null
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

export interface MarketDetail {
  oracle_id: string
  expiryMs: number
  spot: number
  forward: number
  svi: SVIParams | null
  odds: Odds | null
  rangeOdds: RangeOdds[]
  status: 'active' | 'settled' | 'pending'
  minStrike: number
  tickSize: number
}

// ─── Black-76 + SVI Formulas (same as walkthrough) ─────────────────────────

function normCDF(x: number): number {
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

function sviVol(K: number, F: number, T: number, svi: SVIParams): number {
  if (T <= 0) return (svi.sigma / SVI_SCALE)
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

function calcRangeOdds(forward: number, svi: SVIParams, expiryMs: number, minStrike: number, tickSize: number, lowerStrikeUSD: number, upperStrikeUSD: number): RangeOdds | null {
  if (!svi || !forward || forward <= 0) return null
  if (lowerStrikeUSD >= upperStrikeUSD) return null

  const F = forward / PRICE_SCALE
  const T = Math.max(0, (expiryMs - Date.now()) / (365.25 * 24 * 3600 * 1000))

  const lowerK = Math.max(lowerStrikeUSD, minStrike)
  const upperK = upperStrikeUSD

  const volLower = sviVol(lowerK, F, T, svi)
  const volUpper = sviVol(upperK, F, T, svi)

  const probAboveLower = binaryUpProb(F, lowerK, T, volLower)
  const probAboveUpper = binaryUpProb(F, upperK, T, volUpper)

  const probInRange = Math.max(0, probAboveLower - probAboveUpper)
  const probOutOfRange = 1 - probInRange

  return {
    lowerStrike: lowerK,
    upperStrike: upperK,
    rangeWidth: upperK - lowerK,
    inRangeProb: probInRange,
    outRangeProb: probOutOfRange,
    inRangePayout: probInRange > 0.01 ? parseFloat((BET_SIZE / probInRange).toFixed(2)) : 0,
    outRangePayout: probOutOfRange > 0.01 ? parseFloat((BET_SIZE / probOutOfRange).toFixed(2)) : 0,
  }
}

// ─── API Fetchers ────────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getMarket(oracleId: string, signal?: AbortSignal): Promise<MarketDetail | null> {
  try {
    const state = await fetchJSON<OracleState>(`${SERVER}/oracles/${oracleId}/state`, signal)
    const oracles = await fetchJSON<Oracle[]>(`${SERVER}/predicts/${PREDICT_ID}/oracles`, signal)
    const oracle = oracles.find(o => o.oracle_id === oracleId)

    if (!oracle || !state.latest_price || !state.latest_svi) return null

    const forward = state.latest_price.forward
    const spot = state.latest_price.spot
    const svi = state.latest_svi
    const expiryMs = oracle.expiry
    const minStrike = oracle.min_strike / PRICE_SCALE
    const tickSize = oracle.tick_size / PRICE_SCALE

    const odds = calcOdds(forward, spot, svi, expiryMs, minStrike, tickSize)

    // Sample range bets
    const rangeExamples = [
      { name: '±$100', lower: (odds?.strikeK ?? 0) - 100, upper: (odds?.strikeK ?? 0) + 100 },
      { name: '±$200', lower: (odds?.strikeK ?? 0) - 200, upper: (odds?.strikeK ?? 0) + 200 },
      { name: '±$500', lower: (odds?.strikeK ?? 0) - 500, upper: (odds?.strikeK ?? 0) + 500 },
      { name: 'Wide ±$1000', lower: (odds?.strikeK ?? 0) - 1000, upper: (odds?.strikeK ?? 0) + 1000 },
    ]

    const rangeOdds = rangeExamples
      .map(ex => calcRangeOdds(forward, svi, expiryMs, minStrike, tickSize, ex.lower, ex.upper))
      .filter((r): r is RangeOdds => r !== null)

    return {
      oracle_id: oracleId,
      expiryMs,
      spot,
      forward,
      svi,
      odds,
      rangeOdds,
      status: oracle.status,
      minStrike,
      tickSize,
    }
  } catch {
    return null
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useMarket(oracleId: string | null, refreshInterval = 30_000) {
  const [market, setMarket] = useState<MarketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!oracleId) {
      if (!signal?.aborted) {
        setMarket(null)
        setLoading(false)
      }
      return
    }

    try {
      const data = await getMarket(oracleId, signal)
      if (signal?.aborted) return
      if (data) {
        setMarket(data)
        setError(null)
      } else {
        setError('Market not found')
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) return
      setError(err instanceof Error ? err.message : 'Failed to load market')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [oracleId])

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

  return { market, loading, error, refetch: load }
}