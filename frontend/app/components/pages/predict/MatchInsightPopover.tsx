'use client';

/**
 * MatchInsightPopover — anchored on `MatchInsightButton` (Predict
 * page trailing slot).
 *
 * Renders the AI analysis for the currently selected market. The
 * popover is **read-only** in v1: no actions, no refresh, no "open
 * the Compare page" link. Future v1.1 may add a "Re-analyse" button
 * + a "View on Compare" link.
 *
 * Branches:
 *   - **No matchKey** (no market selected) → small empty state.
 *   - **matchKey set, no analysis** → "No analysis yet" message with
 *     a hint pointing to the Compare page.
 *   - **Analysis exists** → headline (direction + size) + confidence
 *     bar, plus a "Show details" toggle that reveals reasoning and
 *     macro backdrop on demand.
 *
 * Per user direction (Part 6):
 *  - Confidence is a visual bar (not just text).
 *  - Reasoning and macro are hidden by default — user clicks
 *    "Show details" to expand.
 *  - All accent colors are green (no cyan) so the popover matches
 *    the Compare table's accent.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Lock, Sparkles, X } from 'lucide-react';
import type { MatchAnalysis } from '@/app/lib/match-analyses';
import type { AccessError } from '@/app/hooks/useMatchInsight';

const green = '#00E68A';
const red = '#ef4444';
const amber = '#FFA500';
const neutral = '#cbd5e1';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const SIGNAL_COLOR: Record<MatchAnalysis['signal'], string> = {
  UP: green,
  DOWN: red,
  NEUTRAL: neutral,
};

interface MatchInsightPopoverProps {
  matchKey: string | null;
  analysis: MatchAnalysis | null;
  accessError: AccessError | null;
  onClose: () => void;
}

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function MatchInsightPopover({
  matchKey,
  analysis,
  accessError,
  onClose,
}: MatchInsightPopoverProps) {
  return (
    <div
      className="absolute bottom-full mb-2 right-0 z-40 w-[360px] rounded-2xl border border-white/10 overflow-hidden"
      style={{
        background: 'rgba(26, 29, 46, 0.95)',
        backdropFilter: 'blur(20px)',
      }}
      role="dialog"
      aria-label="AI market insight"
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      <div className="relative z-10 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={14} style={{ color: green }} />
            <h3 className="text-sm font-bold" style={{ color: textPrimary }}>
              AI insight
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors hover:bg-white/10"
            style={{ color: textSecondary }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {!matchKey ? (
          <EmptyState message="No market selected. Pick a market on the chart to see its AI insight." />
        ) : accessError ? (
          <LockedCta reason={accessError} />
        ) : !analysis ? (
          <EmptyState message="No AI analysis for this market yet. Run one on the Compare page to populate." />
        ) : (
          <AnalysisBody analysis={analysis} />
        )}
      </div>
    </div>
  );
}

/**
 * Render the locked placeholder inside the popover when the requested
 * analysis lives behind the Seal gate and the connected wallet doesn't
 * hold a valid Subscription NFT. Includes a clear CTA to the stake
 * page so the user has a one-click path to unlock.
 */
function LockedCta({ reason }: { reason: AccessError }) {
  const title =
    reason === 'EXPIRED'
      ? 'Subscription expired'
      : 'Subscription required';
  const blurb =
    reason === 'EXPIRED'
      ? 'Your DeepWatch subscription has lapsed. Restake PLP to renew access to encrypted AI insights.'
      : 'This AI insight is encrypted behind the DeepWatch stake gate. Stake PLP to unlock it — random 3 markets per batch stay free.';
  return (
    <div className="space-y-3 py-1">
      <div className="flex items-center gap-2">
        <Lock size={14} style={{ color: amber }} />
        <div
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: amber }}
        >
          {title}
        </div>
      </div>
      <p
        className="text-[11px] leading-relaxed"
        style={{ color: textSecondary }}
      >
        {blurb}
      </p>
      <Link
        href="/app/stake"
        className="inline-flex items-center justify-center w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-90"
        style={{
          background: green,
          color: '#0a0e1a',
        }}
      >
        Stake PLP to unlock
      </Link>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-3 text-xs" style={{ color: textSecondary }}>
      {message}
    </div>
  );
}

// Plain-language direction labels. The trade target is DeepBook Predict;
// Polymarket and Kalshi are reference data used to spot when DB's price
// disagrees with the rest of the market.
const DIRECTION_TEXT: Record<MatchAnalysis['signal'], string> = {
  UP: 'Bet UP',
  DOWN: 'Bet DOWN',
  NEUTRAL: 'No edge',
};
const DIRECTION_BLURB: Record<MatchAnalysis['signal'], string> = {
  UP:
    'Win if the price finishes above the strike. Recommended because the SVI surface (forward vs spot basis, skew, SVI-vs-DB gap) indicates UP is underpriced on DeepBook Predict.',
  DOWN:
    'Win if the price finishes below the strike. Recommended because the SVI surface indicates UP is overpriced on DeepBook Predict.',
  NEUTRAL:
    'No meaningful edge. The SVI surface and cross-venue check are both silent or contradicting.',
};

function positionText(pct: number): { value: string; conviction: string } {
  const p = Math.round(pct);
  if (p < 0.5) {
    return { value: '0% — stay flat', conviction: 'no position' };
  }
  if (p < 2) {
    return { value: `${p}% of your trading budget`, conviction: 'small' };
  }
  if (p < 5) {
    return { value: `${p}% of your trading budget`, conviction: 'medium' };
  }
  if (p < 8) {
    return { value: `${p}% of your trading budget`, conviction: 'large' };
  }
  return { value: `${p}% of your trading budget`, conviction: 'max' };
}

/**
 * Confidence bar — a 0–100 horizontal fill, color-graded by level:
 *   - < 30: red    (low — don't trust this call)
 *   - 30–60: amber (medium — partial conviction)
 *   - 60–80: green (solid — strong enough to size up)
 *   - 80+:  green brighter (high)
 */
function confidenceLevel(p: number): { color: string; label: string } {
  if (p < 30) return { color: red, label: 'low' };
  if (p < 60) return { color: amber, label: 'medium' };
  if (p < 80) return { color: green, label: 'solid' };
  return { color: green, label: 'high' };
}

function AnalysisBody({ analysis }: { analysis: MatchAnalysis }) {
  const [showDetails, setShowDetails] = useState(false);
  const color = SIGNAL_COLOR[analysis.signal];
  const pct = Math.round(analysis.confidence * 100);
  const conf = confidenceLevel(pct);
  const pos = positionText(analysis.positionSizePct);
  const hasDetails =
    !!analysis.reasoning ||
    !!analysis.sviTake ||
    !!analysis.crossVenueTake ||
    !!analysis.macroTake;

  return (
    <>
      <div className="space-y-2.5">
        {/* Headline: direction (large, bold, colored) */}
        <div
          className="font-bold"
          style={{ color, fontSize: 16 }}
        >
          {DIRECTION_TEXT[analysis.signal]}
        </div>

        {/* Suggested Position — labeled field, plain language */}
        <div className="space-y-0.5">
          <div
            className="text-[9px] uppercase tracking-wider font-semibold"
            style={{ color: textSecondary }}
          >
            Suggested Position
          </div>
          <div
            className="font-mono"
            style={{ color: textPrimary, fontSize: 12 }}
          >
            {pos.value}
            {pos.value !== '0% — stay flat' && (
              <span style={{ color: textSecondary }}>
                {' · '}
                <span style={{ color: conf.color }}>{pos.conviction}</span> conviction
              </span>
            )}
          </div>
        </div>

        {/* Plain-language blurb: what the direction means for the user */}
        <p
          className="text-[11px] leading-relaxed"
          style={{ color: textSecondary }}
        >
          {DIRECTION_BLURB[analysis.signal]}
        </p>

        {/* Confidence slider/bar — visual indicator instead of just text */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: textSecondary }}
            >
              Confidence
            </span>
            <span
              className="font-mono font-semibold"
              style={{ color: textPrimary, fontSize: 11 }}
              title="How sure the AI is in this call — bigger cross-venue spread and more venues = higher confidence"
            >
              {pct}% <span style={{ color: conf.color }}>· {conf.label}</span>
            </span>
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Confidence ${pct}%`}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: conf.color,
                transition: 'width 0.2s ease',
              }}
            />
          </div>
        </div>

        {/* Collapsible details — reasoning + macro, hidden by default */}
        {hasDetails && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold transition-colors hover:opacity-80"
              style={{ color: green }}
              aria-expanded={showDetails}
            >
              <ChevronDown
                size={11}
                style={{
                  transition: 'transform 0.15s',
                  transform: showDetails ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
              {showDetails ? 'Hide details' : 'Show details'}
            </button>

            {showDetails && (
              <div className="mt-2 space-y-2 pt-2 border-t border-white/5">
                {analysis.sviTake && (
                  <div
                    className="text-[11px] leading-relaxed"
                    style={{ color: textPrimary }}
                  >
                    <span
                      className="text-[9px] uppercase tracking-wider font-semibold block mb-1"
                      style={{ color: textSecondary }}
                    >
                      SVI analysis
                    </span>
                    {analysis.sviTake}
                    <div
                      className="mt-1 text-[10px]"
                      style={{ color: textSecondary }}
                    >
                      Forward vs spot basis · vol regime · skew · SVI vs DB gap
                    </div>
                  </div>
                )}
                {analysis.crossVenueTake && (
                  <div
                    className="text-[11px] leading-relaxed"
                    style={{ color: textPrimary }}
                  >
                    <span
                      className="text-[9px] uppercase tracking-wider font-semibold block mb-1"
                      style={{ color: textSecondary }}
                    >
                      Cross-venue check
                    </span>
                    {analysis.crossVenueTake}
                    <div
                      className="mt-1 text-[10px]"
                      style={{ color: textSecondary }}
                    >
                      Polymarket &amp; Kalshi sanity check
                    </div>
                  </div>
                )}
                {analysis.reasoning && (
                  <div
                    className="text-[11px] leading-relaxed"
                    style={{ color: textPrimary }}
                  >
                    <span
                      className="text-[9px] uppercase tracking-wider font-semibold block mb-1"
                      style={{ color: textSecondary }}
                    >
                      Final reasoning
                    </span>
                    {analysis.reasoning}
                    <div
                      className="mt-1 text-[10px]"
                      style={{ color: textSecondary }}
                    >
                      SVI + cross-venue synthesis
                    </div>
                  </div>
                )}
                {analysis.macroTake && (
                  <div
                    className="text-[10px] leading-relaxed italic"
                    style={{ color: green, opacity: 0.9 }}
                    title="CoinMarketCap backdrop — affects position size, NOT direction"
                  >
                    <span
                      className="text-[9px] uppercase tracking-wider font-semibold block mb-1 not-italic"
                      style={{ color: textSecondary }}
                    >
                      CoinMarketCap API
                    </span>
                    📊 {analysis.macroTake}
                    <div
                      className="mt-1 not-italic text-[9px]"
                      style={{ color: textSecondary }}
                    >
                      Fear &amp; Greed index · sector sentiment · 24h macro trend
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="pt-2 mt-1 border-t border-white/5 text-[10px] font-mono"
        style={{ color: textSecondary }}
        title={new Date(analysis.createdAt).toLocaleString()}
      >
        Last analysed: {fmtRelative(analysis.createdAt)}
      </div>
    </>
  );
}
