'use client';

/**
 * MatchTable — single dense table of cross-venue comparisons.
 *
 * Anchored on DeepBook Predict: each row is one DeepBook oracle, with
 * the closest-by-expiry Polymarket + Kalshi YES prices shown alongside
 * a per-cell DB premium/discount so the user can immediately see "is
 * DeepBook cheaper or costlier than this venue for the same outcome?".
 *
 * Columns:
 *   1. DeepBook Predict Market — just the question (truncated, tooltip on hover)
 *   2. Expiry                  — relative countdown + absolute UTC
 *   3. DB YES (ATM)            — DeepBook YES price at the ATM strike (baseline)
 *   4. Polymarket YES          — Polymarket YES price of the closest match
 *   5. Kalshi YES              — Kalshi YES price of the closest match
 *   6. AI 🔒                   — locked in v1; tooltip explains the staker features
 *
 * All three venue columns display the YES mint price on the 0–1 scale
 * (e.g. 0.55 = 55¢ to buy 1 YES token that pays $1 if it resolves YES).
 * On a binary market, the YES price is also the implied probability of
 * the UP outcome, so the numbers double as probabilities — but we
 * show them as prices since the comparison is "is this venue cheaper
 * or costlier to buy YES than DeepBook for the same outcome?".
 *
 * "Premium" means DB is costlier than the venue (good place to sell on
 * DB, good place to buy on the venue). "Discount" means DB is cheaper
 * (good place to buy on DB, good place to sell on the venue). "Even"
 * when the diff is within noise.
 *
 * The DB YES price is shown as its own column (so users can see the
 * baseline number alongside each venue's price) and Polymarket /
 * Kalshi each show the venue's YES price plus a small
 * "X% premium/discount vs DB" tag. The tag tells the user
 * "DeepBook is X% discount / Y% premium vs this venue for the same
 * outcome", which is what they actually want to act on.
 *
 * Row click opens the per-venue drilldown modal (single yes/no table
 * across all 3 venues). Empty state and first-load skeleton match the
 * previous MatchGrid behaviour.
 */

import { Lock } from 'lucide-react';
import GlassCard from '../../common/GlassCard';
import { formatDetailedExpiry, formatExpiryDate, formatUsd } from '@/app/lib/format';
import type { DeepBookMatch } from '@/app/lib/match';

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const headerBg = 'rgba(255,255,255,0.04)';
const rowHoverBg = 'rgba(255,255,255,0.025)';
const skeletonBg = 'rgba(40, 44, 60, 0.5)';

// Venues are no longer color-coded in the table — header labels are
// plain ("Polymarket", "Kalshi") and price cells use the default
// text color. The VENUE_TINT / VENUE_NAME maps were removed in favour
// of inline strings passed into the cell component.

interface MatchTableProps {
  matches: DeepBookMatch[];
  firstLoad: boolean;
  onSelect: (key: string) => void;
  venuesLoaded: { polymarket: boolean; deepbook: boolean; kalshi: boolean };
}

/**
 * One venue cell: shows the venue's YES price in cents (top, primary
 * color) and the DB premium/discount tag (bottom, green/red, smaller)
 * — same two-row pattern as the Expiry column so the table reads
 * consistently down the rows.
 *
 *   55¢                ← within ±0.5% noise (no tag, just the price)
 *   +28.5% premium     ← DB is 28.5% costlier (red, on a second line)
 *   −28.5% discount    ← DB is 28.5% cheaper (green, on a second line)
 *
 * The price is the YES mint cost displayed in cents (e.g. 55¢ = 0.55
 * = 55% implied prob of the UP outcome). On a binary market the YES
 * price and the implied probability are the same number, but we show
 * it as a price since the user-facing question is "is this venue
 * cheaper or costlier than DB to buy YES for the same outcome?". The
 * delta is `dbPrice − venuePrice` expressed as a percentage, and keeps
 * the "%" suffix because premium/discount are always relative terms.
 */
function CompareCell({
  prob,
  present,
  dbProb,
  venueName,
}: {
  prob: number | undefined;
  present: boolean;
  dbProb: number;
  venueName: 'Polymarket' | 'Kalshi';
}) {
  if (!present || prob === undefined) {
    return (
      <div className="flex flex-col items-end" title={`No ${venueName} market at this expiry`}>
        <span
          className="font-mono font-semibold"
          style={{ color: textSecondary, opacity: 0.45, fontSize: 13, letterSpacing: '-0.01em' }}
        >
          —
        </span>
      </div>
    );
  }
  const deltaPct = (dbProb - prob) * 100;
  const abs = Math.abs(deltaPct);
  const NOISE_PCT = 0.5;
  const isNoise = abs < NOISE_PCT;
  const dbCheaper = deltaPct < 0;
  const sign = deltaPct > 0 ? '+' : '−';
  const color = dbCheaper ? green : red;
  const label = dbCheaper ? 'discount' : 'premium';
  const tooltip = isNoise
    ? `DeepBook ≈ ${venueName} (within ±${NOISE_PCT}%)`
    : dbCheaper
      ? `DeepBook is ${abs.toFixed(1)}% cheaper than ${venueName} — discount on DB.`
      : `DeepBook is ${abs.toFixed(1)}% costlier than ${venueName} — premium on DB.`;
  return (
    <div
      className="flex flex-col items-end"
      title={tooltip}
    >
      <span
        className="font-mono font-semibold"
        style={{ color: textPrimary, fontSize: 13, letterSpacing: '-0.01em' }}
      >
        {(prob * 100).toFixed(0)}¢
      </span>
      {!isNoise && (
        <span
          className="font-mono font-medium"
          style={{ color, fontSize: 10 }}
        >
          {sign}
          {abs.toFixed(1)}% {label}
        </span>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-t border-white/5">
      <td className="px-3 py-2.5"><div className="h-3 w-40 rounded animate-pulse" style={{ background: skeletonBg }} /></td>
      <td className="px-3 py-2.5">
        <div className="flex flex-col items-start gap-1">
          <div className="h-3 w-20 rounded animate-pulse" style={{ background: skeletonBg }} />
          <div className="h-2 w-14 rounded animate-pulse" style={{ background: skeletonBg }} />
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="h-3 w-10 rounded animate-pulse ml-auto" style={{ background: skeletonBg }} />
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex flex-col items-end gap-1">
          <div className="h-3 w-10 rounded animate-pulse" style={{ background: skeletonBg }} />
          <div className="h-2 w-14 rounded animate-pulse" style={{ background: skeletonBg }} />
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex flex-col items-end gap-1">
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
                <th className="px-3 py-2 font-medium text-right" style={{ color: cyan }}>DB YES (ATM)</th>
                <th className="px-3 py-2 font-medium text-right">Polymarket YES</th>
                <th className="px-3 py-2 font-medium text-right">Kalshi YES</th>
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
              <th className="px-3 py-2 font-medium text-right" style={{ color: cyan }} title="DeepBook YES price at the ATM strike — the comparison baseline for the row.">DB YES (ATM)</th>
              <th className="px-3 py-2 font-medium text-right" title="Polymarket YES price of the closest-by-expiry match. Compare to the DB baseline on the left.">Polymarket YES</th>
              <th className="px-3 py-2 font-medium text-right" title="Kalshi YES price of the closest-by-expiry match. Compare to the DB baseline on the left.">Kalshi YES</th>
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

                  {/* DeepBook price — comparison baseline. No delta tag,
                      since this is the source. */}
                  <td className="px-3 py-2.5 text-right">
                    <div
                      className="flex flex-col items-end"
                      title={`DeepBook YES price at ATM: ${(m.dbProb * 100).toFixed(1)}%`}
                    >
                      <span
                        className="font-mono font-semibold"
                        style={{ color: cyan, fontSize: 13, letterSpacing: '-0.01em' }}
                      >
                        {(m.dbProb * 100).toFixed(0)}¢
                      </span>
                    </div>
                  </td>

                  {/* Polymarket — venue YES price + DB delta */}
                  <td className="px-3 py-2.5 text-right">
                    <CompareCell
                      prob={m.polyProb}
                      present={!!m.poly}
                      dbProb={m.dbProb}
                      venueName="Polymarket"
                    />
                  </td>

                  {/* Kalshi — venue YES price + DB delta */}
                  <td className="px-3 py-2.5 text-right">
                    <CompareCell
                      prob={m.kalshiProb}
                      present={!!m.kalshi}
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
