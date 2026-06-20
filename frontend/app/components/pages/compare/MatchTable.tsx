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
 *   3. Deepbook                — DeepBook YES price at the ATM strike (baseline)
 *   4. Polymarket              — Polymarket YES price of the closest match
 *   5. Kalshi                  — Kalshi YES price of the closest match
 *   6. AI                      — per-row AI surface (AiCell: locked /
 *                                analyse button / signal+confidence+prices+reasoning)
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

import GlassCard from '../../common/GlassCard';
import { Sparkles } from 'lucide-react';
import { formatDetailedExpiry, formatExpiryDate } from '@/app/lib/format';
import type { DeepBookMatch } from '@/app/lib/match';
import AiCell from './AiCell';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const headerBg = 'rgba(255,255,255,0.04)';
const rowHoverBg = 'rgba(255,255,255,0.025)';
const skeletonBg = 'rgba(40, 44, 60, 0.5)';

interface MatchTableProps {
  matches: DeepBookMatch[];
  firstLoad: boolean;
  onSelect: (key: string) => void;
  venuesLoaded: { polymarket: boolean; deepbook: boolean; kalshi: boolean };
  /** Called when the user clicks "Analyse" on any row. The page hands
   * the visible matches to `AiBatchProvider.startBatch()`. The cell
   * itself reads its own `isAnalysing` state from the provider. */
  onClickAnalyse: (key: string) => void;
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
      <td className="px-3 py-2.5 text-right">
        <div className="h-3 w-12 rounded animate-pulse ml-auto" style={{ background: skeletonBg }} />
      </td>
    </tr>
  );
}

export default function MatchTable({
  matches,
  firstLoad,
  onSelect,
  venuesLoaded,
  onClickAnalyse,
}: MatchTableProps) {
  if (firstLoad) {
    return (
      <GlassCard className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead style={{ background: headerBg }}>
              <tr className="text-left" style={{ color: textSecondary, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th className="px-3 py-2 font-medium">DeepBook Predict Market</th>
                <th className="px-3 py-2 font-medium">Expiry</th>
                <th className="px-3 py-2 font-medium text-right">Deepbook</th>
                <th className="px-3 py-2 font-medium text-right">Polymarket</th>
                <th className="px-3 py-2 font-medium text-right">Kalshi</th>
                <th className="px-3 py-2 font-medium text-right">AI</th>
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
              <th className="px-3 py-2 font-medium text-right" title="DeepBook YES price at the ATM strike — the comparison baseline for the row.">Deepbook</th>
              <th className="px-3 py-2 font-medium text-right" title="Polymarket YES price of the closest-by-expiry match. Compare to the DB baseline on the left.">Polymarket</th>
              <th className="px-3 py-2 font-medium text-right" title="Kalshi YES price of the closest-by-expiry match. Compare to the DB baseline on the left.">Kalshi</th>
              <th className="px-3 py-2 font-medium text-right" title="AI analysis per row. Click Analyse to run a batch over all visible markets.">AI</th>
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
                        style={{ color: textPrimary, fontSize: 13, letterSpacing: '-0.01em' }}
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

                  {/* AI — per-row surface (locked / signal+conf+prices+reasoning /
                      em-dash). */}
                  <td className="px-3 py-2.5 text-right">
                    <AiCell match={m} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer action bar — global "Run analysis" trigger so the user
          can fire a batch over the currently visible matches at any
          time, without having to find a row's per-cell Analyse button. */}
      <div
        className="px-3 py-2.5 border-t border-white/5 flex items-center justify-between gap-3"
      >
        <span
          className="text-[11px]"
          style={{ color: textSecondary }}
        >
          {matches.length} {matches.length === 1 ? 'match' : 'matches'}
        </span>
        <button
          type="button"
          onClick={() => onClickAnalyse(matches[0]?.key ?? '')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition-opacity hover:opacity-90"
          style={{
            background: green,
            color: '#000',
            fontSize: 11,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
          title="Run AI analysis on every visible match (first 3 free, rest Seal-encrypted)."
        >
          <Sparkles size={12} />
          Run Analyse {matches.length} {matches.length === 1 ? 'match' : 'matches'}
        </button>
      </div>
    </GlassCard>
  );
}
