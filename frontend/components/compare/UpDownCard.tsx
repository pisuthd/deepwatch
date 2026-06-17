'use client';

import GlassCard from '@/app/components/common/GlassCard';
import OracleHeader from './OracleHeader';
import {
  DISPLAY_TICK_USD,
  formatExpiryQuestion,
  formatUsd,
  formatPct,
  roundToTick,
} from '@/lib/markets/format';
import type { ReactNode } from 'react';

export interface UpDownRow {
  strikeUsd: number;
  impliedProbUp: number;
  /**
   * Per-row label from the source API (e.g. "$55,500 or above" for
   * Polymarket/Kalshi). When present, the card uses it directly
   * instead of generating "above or below $X" from the strike.
   */
  description?: string | null;
  /**
   * Polymarket "Up or Down" intraday markets: the BTC open price of
   * the 1-hour candle at the market's eventStartTime. Only set for
   * binary markets with no strike.
   */
  priceToBeatUsd?: number | null;
}

interface UpDownCardProps {
  asset: string;
  expiryMs: number;
  spotUsd: number | null;
  forwardUsd: number | null;
  /** Up/down rows, sorted by strike. */
  rows: UpDownRow[];
  /** Optional eyebrow (e.g. "Polymarket" or "DeepBook Predict"). */
  eyebrow?: ReactNode;
  /**
   * Question from the source API. When present, the card uses it as the
   * title; otherwise it falls back to the generated
   * `${asset} price on ${expiryLabel}?`.
   */
  question?: string | null;
  /** Optional click handler for the UP button. */
  onTrade?: (strike: number, direction: 'up' | 'down') => void;
}

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

function DefaultEyebrow() {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
      DeepBook Predict
    </div>
  );
}

function TradeButton({
  direction,
  prob,
  onClick,
}: {
  direction: 'up' | 'down';
  prob: number;
  onClick?: () => void;
}) {
  const color = direction === 'up' ? green : red;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-2xl px-3 py-2 overflow-hidden border border-white/10 min-w-[5.5rem]"
      style={{
        background: 'rgba(26, 29, 46, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div
        className="absolute -top-4 -right-4 w-12 h-12 rounded-full pointer-events-none"
        style={{ background: color, filter: 'blur(30px)', opacity: 0.15 }}
      />
      <span
        className="relative z-10 text-sm font-semibold"
        style={{ color }}
      >
        {direction === 'up' ? '▲' : '▼'} {formatPct(prob, 2)}
      </span>
    </button>
  );
}

export default function UpDownCard({
  asset,
  expiryMs,
  spotUsd,
  forwardUsd,
  rows,
  eyebrow,
  question,
  onTrade,
}: UpDownCardProps) {
  const centerStrike = spotUsd && spotUsd > 0 ? roundToTick(spotUsd, DISPLAY_TICK_USD) : 0;
  const sortedAll = [...rows].sort((a, b) => a.strikeUsd - b.strikeUsd);
  // Display only 3 rows: lowest, ATM (middle), highest. Larger ladders
  // still get computed upstream; the card just trims for readability.
  const sortedRows = sortedAll.length >= 3
    ? [sortedAll[0], sortedAll[Math.floor(sortedAll.length / 2)], sortedAll[sortedAll.length - 1]]
    : sortedAll;
  const questionText =
    question && question.trim().length > 0
      ? question
      : (() => {
          const expiryLabel = formatExpiryQuestion(expiryMs);
          return expiryLabel
            ? `${asset} price on ${expiryLabel}?`
            : `${asset} price?`;
        })();

  return (
    <GlassCard>
      <OracleHeader
        asset={asset}
        expiryMs={expiryMs}
        eyebrow={eyebrow ?? <DefaultEyebrow />}
      />

      <h2
        className="text-base font-bold mb-3 leading-snug"
        style={{ color: textPrimary }}
      >
        {questionText}
      </h2>

      <div className="border-t border-white/5 -mx-1" />

      <div className="max-h-[450px] overflow-y-auto pr-1 mt-1">
        {sortedRows.length === 0 ? (
          <div
            className="text-center text-xs py-8"
            style={{ color: textSecondary }}
          >
            Awaiting oracle data…
          </div>
        ) : (
          sortedRows.map((r) => {
            // Per-row label:
            //   1. Prefer the API description (e.g. "$55,500 or above")
            //   2. Otherwise, if the row has a strike, generate
            //      "above or below $X" (multi-strike ladders)
            //   3. Otherwise (binary "Up or Down" with no strike):
            //      - if we have the Price To Beat, show "$X or above"
            //      - otherwise show "Up from open"
            const rowLabel = (() => {
              if (r.description && r.description.trim().length > 0) {
                return r.description;
              }
              if (r.strikeUsd > 0) {
                return `${formatUsd(r.strikeUsd)} or above`;
              }
              if (r.priceToBeatUsd && r.priceToBeatUsd > 0) {
                return `${formatUsd(r.priceToBeatUsd)} or above`;
              }
              return 'Up from open';
            })();
            const isCenter = r.strikeUsd === centerStrike;
            return (
              <div
                key={r.strikeUsd}
                className="w-full flex items-center justify-between rounded-xl px-3 py-2 mb-1 transition-all"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="text-base font-semibold truncate"
                    style={{ color: textPrimary }}
                  >
                    {rowLabel}
                  </span>
                  {isCenter && (
                    <span
                      className="text-[10px] shrink-0"
                      style={{ color: textSecondary }}
                    >
                      ATM
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <TradeButton
                    direction="up"
                    prob={r.impliedProbUp}
                    onClick={() => onTrade?.(r.strikeUsd, 'up')}
                  />
                  <TradeButton
                    direction="down"
                    prob={1 - r.impliedProbUp}
                    onClick={() => onTrade?.(r.strikeUsd, 'down')}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </GlassCard>
  );
}
