'use client';

import { useEffect, useState } from 'react';
import { usePredict, type RangeQuote } from '../../../hooks/usePredict';
import { formatPrice } from './utils';

const TEXT_PRIMARY = '#ffffff';
const TEXT_SECONDARY = '#9ca3af';
const TEXT_MUTED = '#6b7280';
const GREEN = '#00E68A';
const GREEN_SOFT = 'rgba(0, 230, 138, 0.12)';
const GREEN_BORDER = 'rgba(0, 230, 138, 0.35)';
const RED = '#ef4444';

interface RangePanelProps {
  oracleId: string | null;
  expiryMs: number;
  spotUsd: number;
  lower: number;
  upper: number;
  /** Convenience: opens the trade modal. */
  onPlaceBet: () => void;
}

/**
 * Right-column panel rendered next to the chart when Advanced mode is in
 * range mode. Mirrors the role that `StrikeGrid` plays for binary mode but
 * surfaces range-specific stats: bounds, half-width, position vs. spot, a
 * live preview quote for 1 DBUSDC, and the action button to open the trade
 * modal. The chart's two drag lines are still the primary bounds editor —
 * this panel just summarises and acts.
 */
export default function RangePanel({
  oracleId,
  expiryMs,
  spotUsd,
  lower,
  upper,
  onPlaceBet,
}: RangePanelProps) {
  const { getRangeQuote } = usePredict();
  const [quote, setQuote] = useState<RangeQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Live preview quote — always 1 DBUSDC so the user sees per-unit
  // cost/payout. Refreshes whenever bounds change. Cheap: ~5s polling.
  const quoteKey = `${oracleId}|${expiryMs}|${lower}|${upper}`;
  useEffect(() => {
    if (!getRangeQuote || !oracleId || !expiryMs || lower <= 0 || upper <= lower) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const fetchQuote = async () => {
      setQuoteLoading(true);
      try {
        const q = await getRangeQuote(oracleId, expiryMs, lower, upper, 1);
        if (!cancelled) setQuote(q);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    };
    fetchQuote();
    const id = setInterval(fetchQuote, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, getRangeQuote]);

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

  // Implied probability from the quote: payout × p = cost → p = cost/payout.
  // Both fields are per-unit when quantity=1, so this is the market's
  // current pricing of the bet landing inside the band.
  const impliedProb =
    quote && quote.payout > 0
      ? Math.max(0, Math.min(100, (quote.cost / quote.payout) * 100))
      : null;
  const payoutMultiple =
    quote && quote.cost > 0 ? quote.payout / quote.cost : null;

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
        className="px-4 py-3 border-b border-white/5"
        style={{ color: TEXT_SECONDARY }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide">Range Bet</span>
          <span
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{
              background: spotInside ? GREEN_SOFT : 'rgba(239,68,68,0.12)',
              color: spotInside ? GREEN : RED,
            }}
          >
            {spotInside ? 'IN' : 'OUT'}
          </span>
        </div>
        <p className="text-[10px] mt-1.5" style={{ color: TEXT_MUTED }}>
          Drag the lines on the chart to adjust bounds.
        </p>
      </div>

      {/* Bounds summary */}
      <div className="px-4 py-3 grid grid-cols-2 gap-3 border-b border-white/5">
        <div>
          <div
            className="text-[10px] uppercase tracking-wide"
            style={{ color: TEXT_SECONDARY }}
          >
            Lower
          </div>
          <div
            className="text-sm font-bold mt-0.5"
            style={{ color: TEXT_PRIMARY }}
          >
            {validBounds ? formatPrice(lower) : '—'}
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[10px] uppercase tracking-wide"
            style={{ color: TEXT_SECONDARY }}
          >
            Upper
          </div>
          <div
            className="text-sm font-bold mt-0.5"
            style={{ color: TEXT_PRIMARY }}
          >
            {validBounds ? formatPrice(upper) : '—'}
          </div>
        </div>
        <div>
          <div
            className="text-[10px] uppercase tracking-wide"
            style={{ color: TEXT_SECONDARY }}
          >
            Center
          </div>
          <div
            className="text-xs font-semibold mt-0.5"
            style={{ color: TEXT_PRIMARY }}
          >
            {validBounds ? formatPrice(center) : '—'}
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[10px] uppercase tracking-wide"
            style={{ color: TEXT_SECONDARY }}
          >
            Half-width
          </div>
          <div
            className="text-xs font-semibold mt-0.5"
            style={{ color: TEXT_PRIMARY }}
          >
            {validBounds ? `±${formatPrice(halfWidth)}` : '—'}
          </div>
        </div>
      </div>

      {/* Spot context */}
      <div
        className="px-4 py-3 flex items-center justify-between border-b border-white/5"
      >
        <span
          className="text-[10px] uppercase tracking-wide"
          style={{ color: TEXT_SECONDARY }}
        >
          Spot
        </span>
        <div className="text-right">
          <div
            className="text-xs font-bold"
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

      {/* Live preview quote (per 1 DBUSDC) */}
      <div className="flex-1 overflow-auto px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span
            className="text-[10px] uppercase tracking-wide"
            style={{ color: TEXT_SECONDARY }}
          >
            Preview · 1 DBUSDC
          </span>
          {quoteLoading && quote === null && (
            <span className="text-[10px]" style={{ color: TEXT_MUTED }}>
              fetching…
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div
              className="text-[10px] uppercase tracking-wide"
              style={{ color: TEXT_SECONDARY }}
            >
              Cost
            </div>
            <div
              className="text-sm font-bold mt-0.5"
              style={{ color: TEXT_PRIMARY }}
            >
              {quote ? `$${quote.cost.toFixed(4)}` : '—'}
            </div>
          </div>
          <div className="text-right">
            <div
              className="text-[10px] uppercase tracking-wide"
              style={{ color: TEXT_SECONDARY }}
            >
              Payout
            </div>
            <div
              className="text-sm font-bold mt-0.5"
              style={{ color: GREEN }}
            >
              {quote ? `$${quote.payout.toFixed(4)}` : '—'}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <div
              className="text-[10px] uppercase tracking-wide"
              style={{ color: TEXT_SECONDARY }}
            >
              Implied prob.
            </div>
            <div
              className="text-xs font-semibold mt-0.5"
              style={{ color: TEXT_PRIMARY }}
            >
              {impliedProb !== null ? `${impliedProb.toFixed(1)}%` : '—'}
            </div>
          </div>
          <div className="text-right">
            <div
              className="text-[10px] uppercase tracking-wide"
              style={{ color: TEXT_SECONDARY }}
            >
              Multiple
            </div>
            <div
              className="text-xs font-semibold mt-0.5"
              style={{ color: TEXT_PRIMARY }}
            >
              {payoutMultiple !== null ? `${payoutMultiple.toFixed(2)}×` : '—'}
            </div>
          </div>
        </div>

        {/* Probability bar — visualises implied prob across [0, 100]. */}
        {impliedProb !== null && (
          <div className="mt-3">
            <div
              className="h-1.5 w-full rounded-full overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${impliedProb}%`,
                  background: GREEN,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Action button — sits inside the panel, replacing the old chart
          overlay. Disabled while bounds are invalid. */}
      <div className="px-4 py-3 border-t border-white/5">
        <button
          onClick={onPlaceBet}
          disabled={!validBounds}
          className="w-full py-3 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: validBounds ? GREEN : GREEN_SOFT,
            color: validBounds ? '#000' : TEXT_MUTED,
            border: `1px solid ${validBounds ? GREEN : GREEN_BORDER}`,
          }}
        >
          {validBounds
            ? `Place Range Bet · ${formatPrice(lower)}–${formatPrice(upper)}`
            : 'Set bounds to continue'}
        </button>
      </div>
    </div>
  );
}
