'use client';

import GlassCard from '@/components/shared/GlassCard';
import OracleHeader from './OracleHeader';
import {
  DISPLAY_TICK_USD,
  formatExpiryQuestion,
  formatUsd,
  formatPct,
  roundToTick,
} from '@/lib/markets/format';
import type { ReactNode } from 'react';

interface UpDownRow {
  strikeUsd: number;
  impliedProbUp: number;
}

interface UpDownCardProps {
  asset: string;
  expiryMs: number;
  spotUsd: number | null;
  forwardUsd: number | null;
  /** Up/down rows (rangeBandPct === 0), sorted by strike. */
  rows: UpDownRow[];
  /** Optional eyebrow (e.g. "Polymarket" or "DeepBook Predict"). */
  eyebrow?: ReactNode;
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
  prob: number; // 0–1
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
  onTrade,
}: UpDownCardProps) {
  const centerStrike = spotUsd && spotUsd > 0 ? roundToTick(spotUsd, DISPLAY_TICK_USD) : 0;
  const sortedAll = [...rows].sort((a, b) => a.strikeUsd - b.strikeUsd);
  // Display only 3 rows: lowest, ATM (middle), highest. The 5-strike ladder
  // is still computed in the lib (for future use); the card trims it.
  const sortedRows = sortedAll.length >= 3
    ? [sortedAll[0], sortedAll[Math.floor(sortedAll.length / 2)], sortedAll[sortedAll.length - 1]]
    : sortedAll;
  const expiryLabel = formatExpiryQuestion(expiryMs);
  const question = expiryLabel
    ? `${asset} price on ${expiryLabel}?`
    : `${asset} price?`;

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
        {question}
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
                    {formatUsd(r.strikeUsd)} or above
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
