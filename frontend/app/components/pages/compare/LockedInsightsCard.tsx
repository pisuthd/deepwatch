'use client';

/**
 * LockedInsightsCard — compact, expandable placeholder for the
 * staker-gated AI Insights feature. Rendered at the bottom of the
 * Compare page in v1; replaced by `<AISummaryCard /> +
 * <SavedInsightsPanel />` once the `useStakingStatus()` hook lands.
 *
 *   Collapsed (default): single horizontal bar with the lock icon,
 *   the heading, the 6-feature count, and a disabled "Stake now →"
 *   CTA. Non-interactive in v1.
 *
 *   Expanded: the 6 staker features listed inline so the user can
 *   see exactly what they're unlocking — no marketing-vs-reality
 *   gap.
 *
 * The card is dimmed (`opacity-60`) and non-interactive
 * (`pointer-events-none` on the inner content) in v1. The toggle is
 * a thin bar at the bottom of the page, not a full-width block,
 * so the inline AI column in the table remains the primary
 * discoverability surface.
 */

import { useState } from 'react';
import { ChevronDown, Lock, Sparkles } from 'lucide-react';

const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'AI-verified spread',
    body: 'Sanity-check the raw spread against venue liquidity; flag noise vs real divergence.',
  },
  {
    title: 'AI arbitrage signal',
    body: 'Per-row Buy / Sell / Hold call based on the cross-venue consensus.',
  },
  {
    title: 'AI confidence',
    body: '0–100% confidence score using cross-venue agreement + on-chain flow + history.',
  },
  {
    title: 'Divergence reasoning',
    body: 'One-line explanation of why Polymarket × Kalshi × DeepBook disagree on a given row.',
  },
  {
    title: 'Predictive context',
    body: 'LLM-weighted outlook using cross-venue consensus, recent flow, and historical hit rate.',
  },
  {
    title: 'Saved insights',
    body: 'Pin any row to your watchlist, share by link, or export as image.',
  },
];

export default function LockedInsightsCard() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="relative rounded-2xl border border-white/10 opacity-60"
      style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      {/* Bar (always visible, always non-interactive in v1) */}
      <div
        aria-disabled="true"
        className="relative z-10 flex items-center justify-between gap-3 p-3 select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Lock size={14} style={{ color: cyan }} />
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: textPrimary }}
          >
            AI Insights
          </span>
          <span
            className="text-[10px] font-mono"
            style={{ color: textSecondary }}
          >
            6 features available to stakers
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
            style={{
              background: 'rgba(62, 196, 192, 0.12)',
              border: '1px solid rgba(62, 196, 192, 0.3)',
              color: cyan,
            }}
          >
            Stake to unlock
          </span>
          {/* Toggle to expand the feature list. Interactive but doesn't
              claim the feature is "available" — it just reveals the
              detail. Stays inside the dimmed card so the v1 visual
              contract (locked, not for you yet) is preserved. */}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: textSecondary }}
            aria-label={expanded ? 'Hide AI feature list' : 'Show AI feature list'}
            title={expanded ? 'Hide' : 'What does the AI column unlock?'}
          >
            <ChevronDown
              size={14}
              style={{
                transition: 'transform 0.15s',
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              }}
            />
          </button>
        </div>
      </div>

      {/* Expanded feature list — pointer-events-none so the dim
          contract is preserved in v1. */}
      {expanded && (
        <div
          className="relative z-10 px-4 pb-4 pt-1 pointer-events-none"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 mt-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-2.5">
                <Sparkles
                  size={11}
                  style={{ color: cyan, marginTop: 2, flexShrink: 0 }}
                />
                <div className="min-w-0">
                  <div
                    className="text-[11px] font-semibold"
                    style={{ color: textPrimary }}
                  >
                    {f.title}
                  </div>
                  <div
                    className="text-[10px] leading-relaxed"
                    style={{ color: textSecondary }}
                  >
                    {f.body}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
