/**
 * DeepBook Predict synthetic-ladder math.
 *
 * The DeepBook Predict oracle exposes a continuous implied-volatility
 * surface via SVI (Stochastic Volatility Inspired) parameters
 * (`a / b / rho / m / sigma`, plus a `forward`). For the 3-column
 * compare panel we want a finite ladder the user can read at a glance,
 * not the full SVI surface. So we project the surface onto a small
 * grid of standard strikes and a small set of range bands, then read
 * binary "UP" probabilities off that grid with Black-76.
 *
 * This file is the shared math that both `LiveComparePanel` (the
 * user-visible ladder) and the AI prompt (the summary payload) draw
 * from, so the panel and the model are guaranteed to be looking at
 * the same numbers.
 *
 *   - `sviVol(K, F, T, svi)` — total implied vol at strike K
 *   - `binaryUpProb(F, K, T, vol)` — Black-76 P(S_T > K)
 *   - `generateStrikes(centerUsd, count, tick)` — N strikes centered on spot
 *   - `generateRangeBands(spotUsd, tick)` — 2/6/10% bands around spot
 *   - `computeDeepBookLadder(market)` — top-level: returns ready-to-render
 *     `upDown[]` and `range[]` rows in the same shape as Polymarket/Kalshi.
 */

import type { Market as DbMarket } from '../../app/hooks/useMarkets';

/** On-chain scale factors. DeepBook's SVI fields are stored fixed-point. */
const SVI_SCALE = 1e8;
const RHO_SCALE = 1e9;
const PRICE_SCALE = 1e9;

/** Strike grid + range band constants — keep in sync with LiveComparePanel. */
const TICK = 1000;
const N_STRIKES = 5;
const RANGE_BAND_WIDTHS_PCT = [2, 6, 10] as const;

/** Cumulative standard normal — Abramowitz & Stegun 7.1.26 (max error ~1.5e-7). */
function normCDF(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/**
 * SVI total implied vol at strike K. The SVI surface is
 *   w(k) = a + b * (rho * (k - m) + sqrt((k - m)^2 + sigma^2))
 * with k = log(K / F), and vol = sqrt(w / T).
 */
function sviVol(
  K: number,
  F: number,
  T: number,
  svi: { a: number; b: number; rho: number; m: number; sigma: number },
): number {
  if (T <= 0) return svi.sigma / SVI_SCALE;
  const a = svi.a / SVI_SCALE;
  const b = svi.b / SVI_SCALE;
  const rho = svi.rho / RHO_SCALE;
  const m = svi.m / SVI_SCALE;
  const sig = svi.sigma / SVI_SCALE;
  const k = Math.log(K / F);
  const w = a + b * (rho * (k - m) + Math.sqrt((k - m) ** 2 + sig ** 2));
  return w > 0 ? Math.sqrt(w / T) : sig;
}

/** Black-76 P(S_T > K) on a forward contract. */
function binaryUpProb(F: number, K: number, T: number, vol: number): number {
  if (T <= 0 || vol <= 0) return F > K ? 1 : 0;
  const d2 = (Math.log(F / K) - 0.5 * vol ** 2 * T) / (vol * Math.sqrt(T));
  return normCDF(d2);
}

/** N strikes centered on the spot, rounded to the nearest `tick`. */
function generateStrikes(centerUsd: number, count: number, tick: number): number[] {
  if (!centerUsd || count <= 0 || tick <= 0) return [];
  const center = Math.round(centerUsd / tick) * tick;
  const half = Math.floor(count / 2);
  return Array.from({ length: count }, (_, i) => center + (i - half) * tick);
}

/** Three symmetric bands around the spot (2%, 6%, 10%), floored/ceilinged to tick. */
function generateRangeBands(
  spotUsd: number,
  tick: number,
): { floorUsd: number; capUsd: number; widthPct: number }[] {
  if (!spotUsd || spotUsd <= 0 || tick <= 0) return [];
  return RANGE_BAND_WIDTHS_PCT.map((widthPct) => {
    const half = (spotUsd * widthPct) / 200;
    const rawFloor = spotUsd - half;
    const rawCap = spotUsd + half;
    const floorUsd = Math.floor(rawFloor / tick) * tick;
    const capUsd = Math.ceil(rawCap / tick) * tick;
    return { floorUsd, capUsd, widthPct };
  });
}

/** Same row shape as Polymarket/Kalshi ladders, so the AI prompt aligns 1:1. */
export interface DeepBookUpDownRow {
  strikeUsd: number;
  impliedProbUp: number;
  description: string | null;
  priceToBeatUsd: number | null;
}

export interface DeepBookRangeRow {
  floorStrikeUsd: number;
  capStrikeUsd: number;
  rangeBandPct: number;
  impliedProbUp: number;
  description: string | null;
}

export interface DeepBookLadder {
  /** Scaled to USD (÷ PRICE_SCALE) for parity with the JSON payload. */
  spotUsd: number;
  forwardUsd: number;
  upDown: DeepBookUpDownRow[];
  range: DeepBookRangeRow[];
}

/**
 * Project the SVI surface onto a finite ladder for a given DeepBook
 * market. Returns `null` if the market has no SVI / forward data, or if
 * the oracle has already expired (T ≤ 0).
 */
export function computeDeepBookLadder(market: DbMarket): DeepBookLadder | null {
  if (!market.svi || !market.forward || market.forward <= 0) return null;
  const F = market.forward / PRICE_SCALE;
  const spot = (market.spot || 0) / PRICE_SCALE;
  const T = Math.max(
    0,
    (market.expiryMs - Date.now()) / (365.25 * 24 * 3600 * 1000),
  );
  if (T <= 0) return null;

  const strikes = generateStrikes(spot, N_STRIKES, TICK);
  const upDown: DeepBookUpDownRow[] = strikes.map((strikeUsd) => ({
    strikeUsd,
    impliedProbUp: binaryUpProb(F, strikeUsd, T, sviVol(strikeUsd, F, T, market.svi!)),
    description: null,
    priceToBeatUsd: null,
  }));

  const bands = generateRangeBands(spot, TICK);
  const range: DeepBookRangeRow[] = bands.map((b) => {
    const volFloor = sviVol(b.floorUsd, F, T, market.svi!);
    const volCap = sviVol(b.capUsd, F, T, market.svi!);
    const inProb = Math.max(
      0,
      binaryUpProb(F, b.floorUsd, T, volFloor) -
        binaryUpProb(F, b.capUsd, T, volCap),
    );
    return {
      floorStrikeUsd: b.floorUsd,
      capStrikeUsd: b.capUsd,
      rangeBandPct: b.widthPct,
      impliedProbUp: inProb,
      description: null,
    };
  });

  return { spotUsd: spot, forwardUsd: F, upDown, range };
}
