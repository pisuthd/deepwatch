/**
 * SVI (Stochastic Volatility Inspired) parameter model + Black-76 binary
 * probability calculation, ported from old/app/hooks/useSVI.ts and the
 * market math in old/app/hooks/useMarkets.ts. Pure functions, no React.
 *
 * Scales match the on-chain Sui predict module:
 *   PRICE_SCALE = 1e9   (spot, forward, strike)
 *   SVI_SCALE   = 1e8   (a, b, m, sigma)
 *   RHO_SCALE   = 1e9   (rho)
 */

const SVI_SCALE = 1e8;
const RHO_SCALE = 1e9;
const PRICE_SCALE = 1e9;

export interface SVIParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

/** Cumulative normal distribution (Abramowitz & Stegun 7.1.26). */
export function normCDF(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) * t + 0.254829592) * t) *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** Annualised SVI implied vol at log-moneyness k = ln(K/F). */
export function sviVol(K: number, F: number, T: number, svi: SVIParams): number {
  if (T <= 0) return svi.sigma / SVI_SCALE;
  const a = svi.a / SVI_SCALE;
  const b = svi.b / SVI_SCALE;
  const rho = svi.rho / RHO_SCALE;
  const m = svi.m / SVI_SCALE;
  const sig = svi.sigma / SVI_SCALE;
  const k = Math.log(K / F);
  const w = a + b * (rho * (k - m) + Math.sqrt((k - m) ** 2 + sig ** sig));
  return w > 0 ? Math.sqrt(w / T) : sig;
}

/**
 * Black-76 implied probability that the forward price ends above strike K
 * at time T, returned in [0, 1]. Caller passes SVI-scaled or un-scaled params;
 * this function does the scaling.
 */
export function binaryUpProb(F: number, K: number, T: number, vol: number): number {
  if (T <= 0 || vol <= 0) return F > K ? 1 : 0;
  const d2 = (Math.log(F / K) - 0.5 * vol * vol * T) / (vol * Math.sqrt(T));
  return normCDF(d2);
}

/**
 * Compute implied probability for a single strike given the on-chain raw
 * (unscaled) oracle fields. `forward` and `strike` are in raw 1e9 units;
 * `svi` is the raw SVIParams object from the indexer.
 */
export function impliedProbUpForStrike(
  strikeUsd: number,
  forwardRaw: number,
  expiryMs: number,
  svi: SVIParams | null,
): number {
  if (!strikeUsd || strikeUsd <= 0) return 0.5;
  const F = forwardRaw / PRICE_SCALE;
  if (!F || F <= 0) return 0.5;

  const T = Math.max(0, (expiryMs - Date.now()) / (365.25 * 24 * 3600 * 1000));

  // Default SVI (matches the fallback in /old useSVI.ts).
  const params: SVIParams = svi ?? {
    a: 80887,
    b: 9328786,
    rho: 102029829,
    m: 7561599,
    sigma: 9522806,
  };

  const vol = sviVol(strikeUsd, F, T, params);
  return binaryUpProb(F, strikeUsd, T, vol);
}
