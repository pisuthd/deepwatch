'use client';

/**
 * MatchTable — single dense table of cross-venue comparisons.
 *
 * Anchored on DeepBook Predict: each row is one DeepBook oracle, with
 * the closest-by-expiry Polymarket + Kalshi probs shown alongside a
 * per-cell DB premium/discount so the user can immediately see "is
 * DeepBook cheaper or costlier than this venue for the same outcome?".
 *
 * Columns:
 *   1. DeepBook Predict Market — just the question (truncated, tooltip on hover)
 *   2. Expiry                  — relative countdown + absolute UTC
 *   3. Poly                    — Polymarket prob + "X% premium/discount" vs DB
 *   4. Kalshi                  — Kalshi prob + "X% premium/discount" vs DB
 *   5. AI 🔒                   — locked in v1; tooltip explains the staker features
 *
 * "Premium" means DB is costlier than the venue (good place to sell on
 * DB, good place to buy on the venue). "Discount" means DB is cheaper
 * (good place to buy on DB, good place to sell on the venue). "Even"
 * when the diff is within noise.
 *
 * The DB prob itself is not shown as its own column — it's the
 * comparison baseline. Each Poly/Kalshi cell tells the user
 * "DeepBook is X% discount / Y% premium vs this venue for the same
 * outcome", which is what they actually want to act on.
 *
 * Row click opens the per-venue drilldown modal (single yes/no table
 * across all 3 venues). Empty state and first-load skeleton match the
 * previous MatchGrid behaviour.
 */

import { Lock } from 'lucide-react';
import GlassCard from '../../common/GlassCard';
import { formatDetailedExpiry, formatExpiryDate, formatPct, formatUsd } from '@/app/lib/format';
import type { DeepBookMatch } from '@/app/lib/match';

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const headerBg = 'rgba(255,255,255,0.04)';
const rowHoverBg = 'rgba(255,255,255,0.025)';
const skeletonBg = 'rgba(40, 44, 60, 0.5)';

const VENUE_TINT: Record<'poly' | 'kalshi', string> = {
  poly: '#3b82f6',
  kalshi: '#a855f7',
};

const VENUE_NAME: Record<'poly' | 'kalshi', 'Polymarket' | 'Kalshi'> = {
  poly: 'Polymarket',
  kalshi: 'Kalshi',
};

interface MatchTableProps {
  matches: DeepBookMatch[];
  firstLoad: boolean;
  onSelect: (key: string) => void;
  venuesLoaded: { polymarket: boolean; deepbook: boolean; kalshi: boolean };
}

/**
 * One venue cell: shows the venue's UP prob followed by a
 * "X% premium/discount" tag telling the user "is DeepBook cheaper or
 * costlier than this venue for the same outcome?".
 *
 *   55.5%  28.5% premium   ← DB is 28.5pp costlier (red)
 *   55.5%  28.5% discount  ← DB is 28.5pp cheaper (green)
 *   55.5%                  ← within ±0.5pp noise (no tag)
 *
 * The prob is always P(UP) — the cost to buy the UP outcome at that
 * venue. The delta is `dbProb − venueProb` in percentage points, so
 * positive means DB is costlier (premium on DB), negative means DB is
 * cheaper (discount on DB).
 */
function CompareCell({
  prob,
  present,
  tint,
  dbProb,
  venueName,
}: {
  prob: number | undefined;
  present: boolean;
  tint: string;
  dbProb: number;
  venueName: 'Polymarket' | 'Kalshi';
}) {
  if (!present || prob === undefined) {
    return <span style={{ color: textSecondary, opacity: 0.45 }}>—</span>;
  }
  const deltaPp = (dbProb - prob) * 100;
  const abs = Math.abs(deltaPp);
  const NOISE_PP = 0.5;
  const isNoise = abs < NOISE_PP;
  const dbCheaper = deltaPp < 0;
  const sign = deltaPp > 0 ? '+' : '−';
  const color = dbCheaper ? green : red;
  const label = dbCheaper ? 'discount' : 'premium';
  const tooltip = isNoise
    ? `DeepBook ≈ ${venueName} (within ±${NOISE_PP}pp)`
    : dbCheaper
      ? `DeepBook is ${abs.toFixed(1)}pp cheaper than ${venueName} — discount on DB.`
      : `DeepBook is ${abs.toFixed(1)}pp costlier than ${venueName} — premium on DB.`;
  return (
    <span
      className="inline-flex items-baseline justify-end gap-1.5 whitespace-nowrap"
      title={tooltip}
    >
      <span
        className="font-mono font-semibold"
        style={{ color: tint, fontSize: 13, letterSpacing: '-0.01em' }}
      >
        {formatPct(prob, 1)}
      </span>
      {!isNoise && (
        <span
          className="font-mono font-medium"
          style={{ color, fontSize: 11 }}
        >
          {sign}
          {abs.toFixed(1)}% {label}
        </span>
      )}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-t border-white/5">
      <td className="px-3 py-2.5"><div className="h-3 w-40 rounded animate-pulse" style={{ background: skeletonBg }} /></td>
      <td className="px-3 py-2.5"><div className="h-3 w-20 rounded animate-pulse" style={{ background: skeletonBg }} /></td>
      <td className="px-3 py-2.5 text-right">
        <div className="inline-flex flex-col items-end gap-1">
          <div className="h-3 w-10 rounded animate-pulse" style={{ background: skeletonBg }} />
          <div className="h-2 w-14 rounded animate-pulse" style={{ background: skeletonBg }} />
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="inline-flex flex-col items-end gap-1">
          <div className="h-3 w-10 rounded animate-pulse" style={{ background: skeletonBg }} />
          <div className="h-2 w-14 rounded animate-pulse" style={{ background: skeletonBg }} />
        </div>
      </td>
      <td className="px-3 py-2.5 text-right"><div className="h-3 w-6 rounded animate-pulse ml-auto" style={{ background: skeletonBg }} /></td>
    </tr>
  );
}

export default function MatchTable({ matches, firstLoad, onSelect, venuesLoaded }: MatchTableProps) {
  if (firstLoad) {
    return (
      <GlassCard className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead style={{ background: headerBg }}>
              <tr className="text-left" style={{ color: textSecondary, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th className="px-3 py-2 font-medium">DeepBook Predict Market</th>
                <th className="px-3 py-2 font-medium">Expiry</th>
                <th className="px-3 py-2 font-medium text-right">Poly</th>
                <th className="px-3 py-2 font-medium text-right">Kalshi</th>
                <th className="px-3 py-2 font-medium text-right">
                  <span className="inline-flex items-center gap-1">
                    AI <Lock size={9} style={{ color: cyan }} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
            </tbody>
          </table>
        </div>
      </GlassCard>
    );
  }

  if (matches.length === 0) {
    const loaded = (['polymarket', 'deepbook', 'kalshi'] as const).filter(
      (k) => venuesLoaded[k],
    );
    return (
      <GlassCard>
        <div className="text-center py-8 space-y-2">
          <div className="text-sm font-semibold" style={{ color: textPrimary }}>
            No DeepBook markets right now
          </div>
          <div className="text-xs" style={{ color: textSecondary }}>
            {loaded.length === 0
              ? 'Waiting for market data…'
              : `Loaded: ${loaded.join(', ')}.`}
          </div>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead style={{ background: headerBg }}>
            <tr
              className="text-left"
              style={{ color: textSecondary, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              <th className="px-3 py-2 font-medium">DeepBook Predict Market</th>
              <th className="px-3 py-2 font-medium">Expiry</th>
              <th className="px-3 py-2 font-medium text-right" style={{ color: VENUE_TINT.poly }}>Poly</th>
              <th className="px-3 py-2 font-medium text-right" style={{ color: VENUE_TINT.kalshi }}>Kalshi</th>
              <th className="px-3 py-2 font-medium text-right">
                <span className="inline-flex items-center gap-1">
                  AI <Lock size={9} style={{ color: cyan }} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => {
              // Tooltip combines the DB question with the closest
              // competitor framing so users can hover to see "what is
              // Poly/Kalshi actually asking at this expiry?"
              const tooltipParts = [m.dbQuestion];
              if (m.polyQuestion) tooltipParts.push(`Polymarket: ${m.polyQuestion}`);
              if (m.kalshiQuestion) tooltipParts.push(`Kalshi: ${m.kalshiQuestion}`);
              const tooltip = tooltipParts.join('\n');
              return (
                <tr
                  key={m.key}
                  className="border-t border-white/5 cursor-pointer transition-colors hover:bg-white/[0.025]"
                  style={{ background: 'transparent' }}
                  onClick={() => onSelect(m.key)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = rowHoverBg; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(m.key);
                    }
                  }}
                >
                  {/* DeepBook Predict Market — just the question. */}
                  <td className="px-3 py-2.5">
                    <span
                      className="text-sm font-semibold truncate block"
                      style={{ color: textPrimary, maxWidth: 320 }}
                      title={tooltip}
                    >
                      {m.dbQuestion}
                    </span>
                  </td>

                  {/* Expiry */}
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-mono text-[11px]" style={{ color: textPrimary }}>
                        {formatDetailedExpiry(m.expiryMs)}
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: textSecondary }} title={formatExpiryDate(m.expiryMs)}>
                        {formatExpiryDate(m.expiryMs)}
                      </span>
                    </div>
                  </td>

                  {/* Poly — venue prob + DB delta */}
                  <td className="px-3 py-2.5 text-right">
                    <CompareCell
                      prob={m.polyProb}
                      present={!!m.poly}
                      tint={VENUE_TINT.poly}
                      dbProb={m.dbProb}
                      venueName="Polymarket"
                    />
                  </td>

                  {/* Kalshi — venue prob + DB delta */}
                  <td className="px-3 py-2.5 text-right">
                    <CompareCell
                      prob={m.kalshiProb}
                      present={!!m.kalshi}
                      tint={VENUE_TINT.kalshi}
                      dbProb={m.dbProb}
                      venueName="Kalshi"
                    />
                  </td>

                  {/* AI 🔒 */}
                  <td className="px-3 py-2.5 text-right">
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded opacity-50"
                      style={{ background: 'rgba(62, 196, 192, 0.08)' }}
                      title="Stake to unlock AI-verified spread, AI arbitrage signal, and AI confidence."
                    >
                      <Lock size={11} style={{ color: cyan }} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Spot legend — small footer with current spot for ATM context */}
      {matches[0]?.spotUsd != null && matches[0].spotUsd > 0 && (
        <div
          className="px-3 py-1.5 text-[10px] font-mono border-t border-white/5"
          style={{ color: textSecondary }}
        >
          ATM (DB): {formatUsd(matches[0].spotUsd)}
        </div>
      )}
    </GlassCard>
  );
}
