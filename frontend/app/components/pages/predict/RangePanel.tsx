'use client';

import { formatPrice } from './utils';

const TEXT_PRIMARY = '#ffffff';
const TEXT_SECONDARY = '#9ca3af';
const TEXT_MUTED = '#6b7280';
const GREEN = '#00E68A';
const GREEN_SOFT = 'rgba(0, 230, 138, 0.12)';
const RED = '#ef4444';

interface RangePanelProps {
  oracleId: string | null;
  expiryMs: number;
  spotUsd: number;
  lower: number;
  upper: number;
}

/**
 * Right-column panel rendered next to the chart when Advanced mode is in
 * range mode. Surfaces bounds (lower/upper/center/half-width) and the spot
 * position (IN/OUT). The chart's two drag lines are the primary bounds
 * editor; the action button that opens the trade modal now lives outside
 * this panel (in the parent column).
 */
export default function RangePanel({
  oracleId,
  expiryMs,
  spotUsd,
  lower,
  upper,
}: RangePanelProps) {
  const validBounds = lower > 0 && upper > lower;
  const halfWidth = validBounds ? (upper - lower) / 2 : 0;
  const center = validBounds ? (upper + lower) / 2 : 0;
  const spotInside = validBounds && spotUsd >= lower && spotUsd <= upper;
  const spotDistance = validBounds
    ? spotInside
      ? 0
      : spotUsd < lower
        ? lower - spotUsd
        : spotUsd - upper
    : 0;

  return (
    <div
      className="flex flex-col h-full overflow-hidden font-mono"
      style={{
        background: 'rgba(26, 29, 46, 0.6)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 border-b border-white/5 flex items-center justify-between"
        style={{ color: TEXT_SECONDARY }}
      >
        <span className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
          Range Bet
        </span>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded"
          style={{
            background: spotInside ? GREEN_SOFT : 'rgba(239,68,68,0.12)',
            color: spotInside ? GREEN : RED,
          }}
        >
          {spotInside ? 'IN' : 'OUT'}
        </span>
      </div>

      {/* Hint */}
      <p
        className="px-4 pt-2 text-[11px]"
        style={{ color: TEXT_MUTED }}
      >
        Drag chart lines to adjust
      </p>

      {/* Bounds summary */}
      <div className="px-4 py-3 grid grid-cols-2 gap-3 border-b border-white/5">
        <div>
          <div
            className="text-[11px] uppercase tracking-wide"
            style={{ color: TEXT_SECONDARY }}
          >
            Lower
          </div>
          <div
            className="text-base font-bold mt-0.5"
            style={{ color: TEXT_PRIMARY }}
          >
            {validBounds ? formatPrice(lower) : '—'}
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[11px] uppercase tracking-wide"
            style={{ color: TEXT_SECONDARY }}
          >
            Upper
          </div>
          <div
            className="text-base font-bold mt-0.5"
            style={{ color: TEXT_PRIMARY }}
          >
            {validBounds ? formatPrice(upper) : '—'}
          </div>
        </div>
        <div>
          <div
            className="text-[11px] uppercase tracking-wide"
            style={{ color: TEXT_SECONDARY }}
          >
            Center
          </div>
          <div
            className="text-sm font-semibold mt-0.5"
            style={{ color: TEXT_PRIMARY }}
          >
            {validBounds ? formatPrice(center) : '—'}
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[11px] uppercase tracking-wide"
            style={{ color: TEXT_SECONDARY }}
          >
            Half-width
          </div>
          <div
            className="text-sm font-semibold mt-0.5"
            style={{ color: TEXT_PRIMARY }}
          >
            {validBounds ? `±${formatPrice(halfWidth)}` : '—'}
          </div>
        </div>
      </div>

      {/* Spot context */}
      <div className="px-4 py-3 flex items-center justify-between flex-1">
        <span
          className="text-[11px] uppercase tracking-wide"
          style={{ color: TEXT_SECONDARY }}
        >
          Spot
        </span>
        <div className="text-right">
          <div
            className="text-sm font-bold"
            style={{ color: spotInside ? GREEN : TEXT_PRIMARY }}
          >
            {spotUsd > 0 ? formatPrice(spotUsd) : '—'}
          </div>
          {validBounds && !spotInside && spotUsd > 0 && (
            <div className="text-[10px] mt-0.5" style={{ color: RED }}>
              {spotUsd < lower ? '↓' : '↑'} {formatPrice(spotDistance)} away
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
