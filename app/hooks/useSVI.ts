// SVI Model calculation utilities for Predict markets
// These functions calculate implied probabilities using the SVI volatility model

export interface SVIParams {
  a: number
  b: number
  rho: number
  m: number
  sigma: number
}

export interface MintPrice {
  up: number
  down: number
}

const SVI_SCALE = 1e8
const RHO_SCALE = 1e9
const PRICE_SCALE = 1e9

// Cumulative normal distribution
export function normCDF(x: number): number {
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

// SVI volatility calculation
export function sviVol(K: number, F: number, T: number, svi: SVIParams): number {
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

// Binary UP probability calculation (returns 0-100)
export function binaryUpProb(F: number, K: number, T: number, vol: number): number {
  if (T <= 0 || vol <= 0) return F > K ? 100 : 0
  const d2 = (Math.log(F / K) - 0.5 * vol ** 2 * T) / (vol * Math.sqrt(T))
  return normCDF(d2) * 100
}

// Calculate mint price for a given strike
export function calculateMintPrice(
  strike: number,
  forward: number,
  expiryMs: number,
  svi?: SVIParams
): MintPrice {
  if (!strike || strike <= 0) return { up: 50, down: 50 }
  
  const forwardPrice = forward / PRICE_SCALE
  const T = Math.max(0, (expiryMs - Date.now()) / (365.25 * 24 * 3600 * 1000))
  
  const sviParams: SVIParams = svi || {
    a: 80887,
    b: 9328786,
    rho: 102029829,
    m: 7561599,
    sigma: 9522806
  }
  
  const vol = sviVol(strike, forwardPrice, T, sviParams)
  const upProb = binaryUpProb(forwardPrice, strike, T, vol)
  
  return { up: upProb, down: 100 - upProb }
}

// Calculate probabilities for multiple strikes
export function calculateStrikeProbabilities(
  strikes: number[],
  forward: number,
  expiryMs: number,
  svi?: SVIParams
): { strike: number; upProb: number; downProb: number }[] {
  return strikes.map(strike => {
    const { up, down } = calculateMintPrice(strike, forward, expiryMs, svi)
    return {
      strike,
      upProb: up,
      downProb: down
    }
  })
}