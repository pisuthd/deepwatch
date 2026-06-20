/**
 * auto-trade — pure helpers for the Auto Trade feature.
 *
 * No React, no hooks, no I/O. Everything in here is a deterministic
 * function of its inputs so it can be unit-tested in isolation and
 * reused by both the popover (live re-derive on slider change) and
 * the modal (final order set passed to `multiMint`).
 *
 * The two core operations:
 *   1. `deriveStrikeForMarket(market, signal)` — pick the ATM strike
 *      using the same formula as `useMarkets.calcOdds`. Direction is
 *      not used to shift the strike; UP/DOWN is encoded by which side
 *      of K the price closes at.
 *   2. `computeAllocations(orders, opts)` — confidence-weighted split
 *      with a per-market floor, hardcoded lower-confidence floor, and
 *      residual reconciliation so the per-order amounts sum to within
 *      one decimal of the user's budget.
 */

import type { Market } from '../hooks/useMarkets';
import type { MatchAnalysis } from './match-analyses';

export type Direction = 'up' | 'down';

/**
 * An Auto-Trade order — the single source of truth that flows from
 * the popover → the modal → `multiMint`. Every field needed to build
 * the on-chain `market_key::{up,down}` + `predict::mint` moveCalls is
 * pre-computed here so the PTB builder is a dumb loop.
 */
export interface AutoTradeOrder {
  /** Stable identifier for the row. */
  matchKey: string;
  /** On-chain Sui object id of the DeepBook Predict oracle. */
  oracleId: string;
  /** Unix-ms expiry for the `market_key` constructor. */
  expiryMs: number;
  /** Human-dollar strike (already scaled to ATM by `deriveStrikeForMarket`). */
  strike: number;
  /** Direction picked from the AI's `signal`. */
  direction: Direction;
  /** Human-dollar face value the AI is most confident on (used for the row label). */
  asset: string;
  /** Computed allocation in DUSDC (human units, NOT u6 — `multiMint` scales). */
  amount: number;
  /** Confidence 0..1 from the AI analysis (used for the row's confidence pill). */
  confidence: number;
}

/**
 * Derive the ATM strike for a market using the exact formula in
 * `useMarkets.calcOdds` (`useMarkets.ts:143-162`). Direction is
 * intentionally not used — UP/DOWN is encoded by which side of K the
 * price needs to close above/below at expiry, not by the strike
 * itself.
 *
 * Returns `0` if the market has no spot data; callers should drop the
 * order in that case (the trade would fail on-chain anyway).
 */
export function deriveStrikeForMarket(market: Market, _signal: MatchAnalysis['signal']): number {
  if (!market.spot || market.tickSize <= 0) return 0;
  const spotUSD = market.spot / 1e9;
  const K = Math.ceil((spotUSD - market.minStrike) / market.tickSize) * market.tickSize + market.minStrike;
  return K;
}

export interface ComputeAllocationsOptions {
  /** Total DUSDC budget across all kept orders. */
  budget: number;
  /** Hardcoded lower bound on AI confidence — markets below this are
   * dropped regardless of the slider. Protects against a 0%-threshold
   * slider pulling in noise. Default 0.40. */
  minConfidence?: number;
  /** Per-market floor in DUSDC. If `pct_i * budget < floor`, the
   * order is bumped to `floor` and the others are renormalized down.
   * Default 0.50. */
  floor?: number;
}

/**
 * Sort, cap, drop-low-confidence, and split the budget across the
 * kept orders. Returns a fresh array with `amount` filled in.
 *
 * Invariant: `Σ amount_i ∈ [budget − 0.01, budget]`. Rounding the
 * amounts to 2 decimals and reconciling the residual to the
 * highest-confidence order keeps the sum on-budget without pushing
 * any single market above its proportional share by more than
 * `1 ULP` (0.01 DUSDC).
 *
 * If the budget is too small to give every kept order its floor,
 * the call still returns — caller is expected to surface "increase
 * budget or lower the cap" in the UI.
 */
export function computeAllocations(
  orders: Array<Omit<AutoTradeOrder, 'amount'>>,
  opts: ComputeAllocationsOptions,
): AutoTradeOrder[] {
  const { budget, minConfidence = 0.40, floor = 0.50 } = opts;

  if (orders.length === 0 || budget <= 0) return [];

  // 1. Drop sub-confidence-floor markets first (cheaper than the sort).
  const eligible = orders.filter((o) => o.confidence >= minConfidence);
  if (eligible.length === 0) return [];

  // 2. Sort by confidence desc (highest confidence first — receives the
  //    residual on rounding up).
  const sorted = [...eligible].sort((a, b) => b.confidence - a.confidence);

  // 3. Confidence-weighted raw shares.
  const totalC = sorted.reduce((acc, o) => acc + o.confidence, 0);
  if (totalC <= 0) return [];

  const rawShares = sorted.map((o) => ({
    order: o,
    rawShare: o.confidence / totalC,
  }));

  // 4. Apply floor iteratively. Bumping one order to the floor shrinks
  //    the rest proportionally; repeat until no order is below the
  //    floor or the budget is exhausted.
  let allocated = 0;
  let pending: { order: AutoTradeOrder; rawShare: number; amount: number }[] = rawShares.map(
    ({ order, rawShare }) => {
      const initialAmount = rawShare * budget;
      const amount = initialAmount < floor ? floor : initialAmount;
      allocated += amount;
      return {
        order: { ...order, amount: round2(amount) },
        rawShare,
        amount,
      };
    },
  );

  // If we exceeded the budget applying floors, scale everyone down
  // proportionally (preserving relative order).
  if (allocated > budget && allocated > 0) {
    const scale = budget / allocated;
    pending = pending.map((p) => ({
      ...p,
      amount: p.amount * scale,
    }));
    allocated = budget;
  }

  // 5. Round to 2 decimals; reconcile the residual to the highest-
  //    confidence order.
  let rounded = pending.map((p) => ({ ...p, amount: round2(p.amount) }));
  const sumRounded = rounded.reduce((acc, p) => acc + p.amount, 0);
  const residual = round2(budget - sumRounded);
  if (Math.abs(residual) >= 0.005) {
    // Apply the residual to the highest-confidence (index 0).
    rounded[0].amount = round2(rounded[0].amount + residual);
  }

  // 6. If we still went over budget (pathological case), trim from
  //    the LOWEST-confidence order.
  const finalSum = rounded.reduce((acc, p) => acc + p.amount, 0);
  if (finalSum > budget + 0.005 && rounded.length > 0) {
    const last = rounded.length - 1;
    rounded[last].amount = round2(rounded[last].amount - (finalSum - budget));
  }

  return rounded.map((p) => p.order);
}

/**
 * Round to 2 decimals (matches the DUSDC human-unit precision used by
 * `BinaryTradeModal` etc.).
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Format a DUSDC amount as a short human-readable string (e.g. "1.85"
 * for 1.85, "10" for 10.00, "0.50" for 0.50). Trims trailing zeros
 * past 2 decimals.
 */
export function formatDusdc(amount: number): string {
  return amount.toFixed(amount % 1 === 0 ? 0 : 2);
}

/**
 * Build the canonical `matchKey` used everywhere — same shape as
 * `DeepBookMatch.key` and `MatchAnalysis.matchKey`.
 */
export function matchKeyOf(oracleId: string, expiryMs: number): string {
  return `${oracleId}::${expiryMs}`;
}