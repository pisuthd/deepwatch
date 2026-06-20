'use client';

/**
 * useAutoTrade — orchestration hook for the Predict-page Auto Trade
 * feature. Joins `useMarkets()` with the latest AI batch to produce
 * the per-market order set.
 *
 * # Data flow
 *
 *   1. Read `useMarkets()` for the active market list (oracle_id,
 *      asset, expiryMs, spot, minStrike, tickSize).
 *   2. For each market, compute `matchKey = oracleId::expiryMs` and
 *      look up the AI's `MatchAnalysis` via the same precedence
 *      `useMatchInsight` uses: local cache → batch index → encrypted
 *      cache.
 *   3. Drop NEUTRAL signals and confidence-below-threshold entries.
 *      Sort by confidence desc, keep top `maxMarkets`.
 *   4. Compute per-market strike via `deriveStrikeForMarket` (ATM,
 *      matches `useMarkets.calcOdds`).
 *   5. Pass the resulting orders to `computeAllocations` with the
 *      user's budget, floor, and lower-confidence floor.
 *
 * # Confirmation
 *
 * The hook does NOT fire the PTB itself — the modal already owns the
 * `usePredict()` instance (positions + refreshData polling) and calls
 * `usePredict().multiMint(signAndExecute, orders)` directly. This keeps
 * the heavy predict state out of the popover render tree.
 */

import { useMemo } from 'react';
import type { Market } from './useMarkets';
import type { MatchAnalysis } from '../lib/match-analyses';
import { useMatchAnalyses } from '../stores/match-analyses-store';
import { useBatchIndex } from '../stores/batch-index-store';
import {
  computeAllocations,
  deriveStrikeForMarket,
  matchKeyOf,
  type AutoTradeOrder,
} from '../lib/auto-trade';

export interface UseAutoTradeOptions {
  /** Slider value 0–100, in percent. Markets with confidence below this
   * are excluded. */
  confidenceThresholdPct: number;
  /** Total DUSDC budget across the kept markets. */
  budget: number;
  /** Hard cap on how many markets to spread across. */
  maxMarkets: number;
}

export interface UseAutoTradeResult {
  /**
   * The current order set: filtered from the live markets by the AI
   * batch, capped, allocated by confidence. Re-derived whenever the
   * slider inputs change. Empty array means no eligible markets.
   */
  orders: AutoTradeOrder[];
  /**
   * Sum of `orders[].amount`. Should be within 0.01 of the requested
   * budget (the rounding reconciliation lives in
   * `computeAllocations`).
   */
  totalAmount: number;
  /**
   * The latest batch's `batchId`, if any — used by the popover to
   * render the freshness badge ("from batch 8a3f… · 2m ago").
   */
  latestBatchId: string | null;
}

/**
 * Resolve the best `MatchAnalysis` for a given market from the
 * available stores. Mirrors `useMatchInsight` lookup precedence but
 * returns `null` for markets that have no batch analysis at all (the
 * Auto Trade popover excludes these rather than fetching on demand).
 */
function resolveAnalysis(
  matchKey: string,
  local: MatchAnalysis | null,
  batches: ReturnType<typeof useBatchIndex>['all'],
): MatchAnalysis | null {
  if (local) return local;
  // Walk the batches newest-first (already sorted by `refresh()`) and
  // return the first hit across `results` and `encryptedResults`.
  for (const b of batches) {
    const r = b.results[matchKey];
    if (r) return r;
    const er = b.encryptedResults?.[matchKey];
    if (er) return er;
  }
  return null;
}

export function useAutoTrade(
  markets: Market[] | null | undefined,
  options: UseAutoTradeOptions,
): UseAutoTradeResult {
  const { confidenceThresholdPct, budget, maxMarkets } = options;
  const { getByMatchKey, hydrated: analysesHydrated } = useMatchAnalyses();
  const batchIndex = useBatchIndex();

  const orders: AutoTradeOrder[] = useMemo(() => {
    if (!markets || markets.length === 0) return [];
    if (!batchIndex.hydrated && !analysesHydrated) return [];

    const threshold = Math.max(0, Math.min(1, confidenceThresholdPct / 100));
    const cap = Math.max(1, Math.min(10, maxMarkets));

    // 1. Walk all active markets, join with the AI analysis.
    const candidates: Array<Omit<AutoTradeOrder, 'amount'>> = [];
    for (const m of markets) {
      if (m.status !== 'active') continue;
      const matchKey = matchKeyOf(m.oracle_id, m.expiryMs);
      const local = analysesHydrated ? getByMatchKey(matchKey) : null;
      const analysis = resolveAnalysis(matchKey, local, batchIndex.all);
      if (!analysis) continue;
      if (analysis.signal === 'NEUTRAL') continue;
      if (analysis.confidence < threshold) continue;

      const direction = analysis.signal === 'UP' ? 'up' : 'down';
      const strike = deriveStrikeForMarket(m, analysis.signal);
      if (strike <= 0) continue; // no spot data → can't form a market key

      candidates.push({
        matchKey,
        oracleId: m.oracle_id,
        expiryMs: m.expiryMs,
        strike,
        direction,
        asset: m.asset,
        confidence: analysis.confidence,
      });
    }

    // 2. Sort by confidence desc, keep top `cap`.
    const top = [...candidates]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, cap);

    // 3. Allocate the budget.
    return computeAllocations(top, { budget });
  }, [
    markets,
    batchIndex.hydrated,
    batchIndex.all,
    analysesHydrated,
    getByMatchKey,
    confidenceThresholdPct,
    budget,
    maxMarkets,
  ]);

  const totalAmount = useMemo(
    () => orders.reduce((acc, o) => acc + o.amount, 0),
    [orders],
  );

  return {
    orders,
    totalAmount,
    latestBatchId: batchIndex.latest?.batchId ?? null,
  };
}