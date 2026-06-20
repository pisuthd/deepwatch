'use client';

/**
 * MatchInsightButton — trailing button on the Predict page (alongside
 * `PositionsButton`).
 *
 * Surfaces the per-market AI analysis for the *currently selected*
 * market on Predict. Backed by `useMatchInsight`, which looks up
 * the analysis from:
 *   1. `useMatchAnalyses()` (local per-row cache, populated by
 *      `AiBatchProvider` when a batch completes)
 *   2. `useBatchIndex()` (localStorage cache of already-fetched
 *      Walrus batch blobs)
 *   3. Walrus (lazy fetch of the latest CERTIFIED batch blob)
 *
 * Visible to **every wallet**, not just stakers. The button label
 * adapts:
 *
 *   - **No analysis yet** → dimmed "AI" pill.
 *   - **Analysis exists** → signal pill (`▲ UP · 5%` /
 *     `▼ DOWN · 3%` / `▬ NEUTRAL · 0%`), color-coded to match the
 *     `AiCell` Branch C on the Compare table.
 *   - **Analysis is encrypted + no staker access** → popover shows
 *     the `LockedCta` (subscription required) when opened. The
 *     button itself still shows the same dimmed "AI" pill, since the
 *     hit is unknown until the popover runs `useMatchInsight`.
 *
 * The staker gate was previously here (returned `null` when
 * `!isStaker`). It moved into the popover as the `accessError`
 * branch, so the Predict page mirrors the Compare page's free-slice
 * visibility: first 3 markets per batch are public, rest require a
 * stake.
 *
 * Outside-click closes (same pattern as `PositionsButton`).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useCurrentMarket } from './CurrentMarketContext';
import { useMatchInsight } from '@/app/hooks/useMatchInsight';
import MatchInsightPopover from './MatchInsightPopover';
import type { MatchAnalysis } from '@/app/lib/match-analyses';

const green = '#00E68A';
const red = '#ef4444';
const neutral = '#cbd5e1';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const SIGNAL_GLYPH: Record<MatchAnalysis['signal'], string> = {
  UP: '▲',
  DOWN: '▼',
  NEUTRAL: '▬',
};
const SIGNAL_LABEL: Record<MatchAnalysis['signal'], string> = {
  UP: 'UP',
  DOWN: 'DOWN',
  NEUTRAL: 'NEUTRAL',
};
const SIGNAL_COLOR: Record<MatchAnalysis['signal'], string> = {
  UP: green,
  DOWN: red,
  NEUTRAL: neutral,
};

export default function MatchInsightButton() {
  const { oracleId, expiryMs } = useCurrentMarket();
  const matchKey = useMemo<string | null>(
    () => (oracleId && expiryMs ? `${oracleId}::${expiryMs}` : null),
    [oracleId, expiryMs],
  );
  const { analysis, accessError } = useMatchInsight(matchKey);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Outside-click closes. Mirrors `PositionsButton`.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Listen for the `deepwatch:open-match-insight` custom event so
  // `AutoPopupMatchInsight` can open this button's popover on mount
  // + on `matchKey` change. The event is filtered to the current
  // `matchKey` so a stale dispatch (e.g. after a market switch) can't
  // re-open the popover for the wrong market.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ matchKey?: string | null }>).detail;
      if (!detail || detail.matchKey == null) return;
      if (detail.matchKey !== matchKey) return;
      setOpen(true);
    };
    window.addEventListener('deepwatch:open-match-insight', handler);
    return () => window.removeEventListener('deepwatch:open-match-insight', handler);
  }, [matchKey]);

  // Label + color for the button. With an analysis, show the signal
  // pill; without, show a dimmed "AI" label. The popover (opened on
  // click) handles the `accessError` branch — locked CTA when the
  // user lacks a subscription and the requested insight is in the
  // encrypted slice.
  const hasAnalysis = analysis !== null;
  const signalColor = analysis ? SIGNAL_COLOR[analysis.signal] : textSecondary;
  const signalText = analysis
    ? `${SIGNAL_GLYPH[analysis.signal]} ${SIGNAL_LABEL[analysis.signal]} · ${Math.round(analysis.positionSizePct)}%`
    : 'AI';

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors hover:bg-white/5"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-default)',
          color: open ? green : textPrimary,
          opacity: hasAnalysis ? 1 : 0.7,
        }}
        aria-label="AI insight for this market"
        title={
          hasAnalysis
            ? `${SIGNAL_LABEL[analysis.signal]} signal — ${Math.round(analysis.confidence * 100)}% confidence`
            : 'AI insight for this market. Open to view the analysis or unlock the encrypted slice.'
        }
      >
        <Sparkles size={14} style={{ color: hasAnalysis ? green : textSecondary }} />
        <span
          className="text-xs font-mono font-semibold uppercase tracking-wider"
          style={{ color: hasAnalysis ? signalColor : textSecondary, fontSize: 11 }}
        >
          {signalText}
        </span>
      </button>

      {open && (
        <MatchInsightPopover
          matchKey={matchKey}
          analysis={analysis}
          accessError={accessError}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
