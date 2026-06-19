'use client';

/**
 * AiCell — the per-row AI column on the Compare table.
 *
 * Three branches driven by `useStake` and `useMatchAnalyses`:
 *
 *   A. **Locked** (no wallet / not a staker in v1)
 *      → dimmed Lock icon, "Connect a staked wallet to use AI insights"
 *
 *   B. **Staker, no analysis yet**
 *      → right-aligned "Analyse" pill button (Sparkles + label).
 *        onClick → `onClickAnalyse(match.key)` so the parent can
 *        open the batch modal and analyse all visible matches at once.
 *
 *   C. **Staker, analysis exists**
 *      → four compact lines:
 *           1. signal pill (`▲ UP · 5%` / `▼ DOWN · 3%` / `▬ NEUTRAL · 0%`)
 *           2. confidence (e.g. `conf 72%`)
 *           3. price line (`DB 55¢ · Poly 51¢ · Kalshi 52%`)
 *           4. reasoning, truncated, full text in `title` tooltip
 *
 * The cell is read-only once populated (Branch C) — v1 doesn't expose
 * a re-analyse affordance. To force a refresh, clear `localStorage`
 * `deepwatch:match-analyses:v1` and click Analyse again. The real
 * fix (per-row refresh + staleness indicator) is a v1.1 follow-up.
 *
 * Visual constants are shared with `MatchTable` so the cell reads
 * consistently against the rest of the row.
 */

import { useMemo } from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { useStake } from '@/app/hooks/useStake';
import { useMatchAnalyses } from '@/app/stores/match-analyses-store';
import { useAiBatch } from '@/app/stores/ai-batch-store';
import type { DeepBookMatch } from '@/app/lib/match';
import type { MatchAnalysis } from '@/app/lib/match-analyses';

const green = '#00E68A';
const red = '#ef4444';
const neutral = '#cbd5e1';
const textSecondary = '#9ca3af';

interface AiCellProps {
  match: DeepBookMatch;
  /** Clicked "Analyse" — parent snapshots visible matches and hands
   * them to `AiBatchProvider.startBatch()`. The cell reads its own
   * `isAnalysing` state from the provider (this row is part of the
   * in-flight batch iff the provider's `phase === 'analysing'` and
   * this row is in `state.matches`). */
  onClickAnalyse: (key: string) => void;
}

const SIGNAL_COLOR: Record<MatchAnalysis['signal'], string> = {
  UP: green,
  DOWN: red,
  NEUTRAL: neutral,
};

// Plain-language direction labels. The trade target is DeepBook Predict;
// Polymarket and Kalshi are reference data used to spot when DB's price
// disagrees with the rest of the market.
const DIRECTION_TEXT: Record<MatchAnalysis['signal'], string> = {
  UP: 'Bet UP',
  DOWN: 'Bet DOWN',
  NEUTRAL: 'No edge',
};
const DIRECTION_TOOLTIP: Record<MatchAnalysis['signal'], string> = {
  UP:
    'Bet the UP outcome on DeepBook Predict. You win if the price finishes above the strike at expiry. UP is recommended because DB\'s price is below the cross-venue consensus — DB looks "cheap" relative to Polymarket and Kalshi.',
  DOWN:
    'Bet the DOWN outcome on DeepBook Predict. You win if the price finishes below the strike at expiry. DOWN is recommended because DB\'s price is above the cross-venue consensus — DB looks "rich" relative to Polymarket and Kalshi.',
  NEUTRAL:
    'No meaningful edge — the cross-venue spread is too small to justify a trade. Stay flat on this market.',
};

function positionText(pct: number): string {
  if (pct < 0.5) return '0%';
  if (pct < 2) return `${Math.round(pct)}%`;
  if (pct < 5) return `${Math.round(pct)}%`;
  if (pct < 8) return `${Math.round(pct)}%`;
  return `${Math.round(pct)}%`;
}

function confidenceText(c: number): string {
  return `${Math.round(c * 100)}% sure`;
}

/**
 * Render the Branch C "analysis" view. Pure — given a MatchAnalysis
 * + the match's per-venue probs, returns JSX.
 *
 * Per user direction (Part 5): "we should show only nessary here and
 * move the rest to the modal." The cell shows only the trade call
 * (direction + size + confidence). Everything else — reasoning,
 * macro backdrop, price line, timestamp — lives in the hover
 * tooltip on the cell (and in the Predict page's MatchInsightPopover
 * for the long-form view).
 */
function AnalysisView({
  analysis,
  match,
}: {
  analysis: MatchAnalysis;
  match: DeepBookMatch;
}) {
  const color = SIGNAL_COLOR[analysis.signal];

  // Price line uses the same source-of-truth as the row itself, so
  // the per-venue numbers stay in sync with the rest of the table.
  const dbPrice = Math.round(match.dbProb * 100);
  const polyPrice =
    typeof match.polyProb === 'number'
      ? Math.round(match.polyProb * 100)
      : null;
  const kalshiPrice =
    typeof match.kalshiProb === 'number'
      ? Math.round(match.kalshiProb * 100)
      : null;

  // Cross-venue consensus = median of present venue probs. Computed
  // client-side so the tooltip can show the same number the AI used.
  const present = [match.dbProb, match.polyProb, match.kalshiProb].filter(
    (p): p is number => typeof p === 'number',
  );
  let consensusPct: number | null = null;
  if (present.length > 0) {
    const sorted = [...present].sort((a, b) => a - b);
    consensusPct = Math.round(sorted[Math.floor(sorted.length / 2)] * 100);
  }

  // Tooltip = full detail moved off the cell.
  const priceLineParts = [`DB ${dbPrice}¢`];
  if (polyPrice !== null) priceLineParts.push(`Poly ${polyPrice}¢`);
  if (kalshiPrice !== null) priceLineParts.push(`Kalshi ${kalshiPrice}¢`);
  if (consensusPct !== null) priceLineParts.push(`market avg ${consensusPct}¢`);

  const tooltipLines = [
    `${DIRECTION_TOOLTIP[analysis.signal]}`,
    '',
    `Cross-venue: ${priceLineParts.join(' · ')}`,
    '',
    `Why: ${analysis.reasoning}`,
    analysis.macroTake ? `Macro: ${analysis.macroTake}` : null,
    '',
    `Generated ${new Date(analysis.createdAt).toLocaleString()}`,
  ].filter((l): l is string => l !== null);

  return (
    <div
      className="flex flex-col items-end gap-0.5 max-w-[160px] cursor-help"
      title={tooltipLines.join('\n')}
    >
      <span
        className="font-bold"
        style={{ color, fontSize: 11 }}
      >
        {DIRECTION_TEXT[analysis.signal]}
      </span>
      <span
        className="font-mono"
        style={{ color: textSecondary, fontSize: 10 }}
      >
        {positionText(analysis.positionSizePct)} bankroll · {confidenceText(analysis.confidence)}
      </span>
    </div>
  );
}

export default function AiCell({ match, onClickAnalyse }: AiCellProps) {
  const { isStaker } = useStake();
  const { getByMatchKey, hydrated } = useMatchAnalyses();
  const { state } = useAiBatch();

  // "This row is part of the in-flight batch" = the provider is
  // currently analysing (or reviewing) AND this row is in the snapshot
  // of matches the batch was kicked with. Cells outside that snapshot
  // (e.g. a row that arrived via the 90 s poll mid-batch) do NOT get
  // the "Analysing…" label, because they weren't part of the request.
  const isAnalysing = useMemo<boolean>(() => {
    if (state.phase !== 'analysing' && state.phase !== 'reviewing') return false;
    return state.matches?.some((m) => m.key === match.key) ?? false;
  }, [state.phase, state.matches, match.key]);

  // While the store is hydrating from localStorage, optimistically
  // render Branch A (locked) so we don't flash a staker Analyse pill
  // that vanishes a frame later when the persisted read restores. The
  // store hydrates synchronously inside a useEffect — by the second
  // render the real answer is in place.
  //
  // In-flight results from the provider's `latestResults` take
  // precedence over the persisted cache, so the cell updates in
  // real-time as the SSE stream produces results (no need to wait
  // for the batch's `onBatchComplete` flush).
  const persisted = useMemo<MatchAnalysis | null>(
    () => (hydrated ? getByMatchKey(match.key) : null),
    [hydrated, getByMatchKey, match.key],
  );
  const inFlight = useMemo<MatchAnalysis | null>(
    () => (state.phase === 'analysing' ? state.latestResults[match.key] ?? null : null),
    [state.phase, state.latestResults, match.key],
  );
  const analysis = inFlight ?? persisted;

  // Branch A — locked.
  if (!isStaker) {
    return (
      <div className="flex justify-end">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded opacity-50"
          style={{ background: 'rgba(0, 230, 138, 0.08)' }}
          title="Connect a staked wallet to use AI insights."
        >
          <Lock size={11} style={{ color: green }} />
        </span>
      </div>
    );
  }

  // Branch C — analysis exists.
  if (analysis) {
    return (
      <div className="flex justify-end">
        <AnalysisView analysis={analysis} match={match} />
      </div>
    );
  }

  // Branch B — staker, no analysis yet. The button is the trigger for
  // the batch modal; it stays right-aligned to mirror the row's other
  // venue cells.
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation(); // don't open the drilldown modal too
          onClickAnalyse(match.key);
        }}
        disabled={isAnalysing}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded uppercase font-semibold transition-opacity disabled:opacity-50"
        style={{
          background: 'rgba(0, 230, 138, 0.12)',
          border: '1px solid rgba(0, 230, 138, 0.3)',
          color: green,
          fontSize: 10,
          letterSpacing: '0.05em',
        }}
        title="Run AI analysis on this market."
      >
        <Sparkles size={10} />
        {isAnalysing ? 'Analysing…' : 'Analyse'}
      </button>
    </div>
  );
}
