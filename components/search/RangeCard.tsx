'use client';

import GlassCard from '@/components/shared/GlassCard';
import OracleHeader from './OracleHeader';
import { Check, X } from 'lucide-react';
import { formatExpiryQuestion, formatPct, formatUsd } from '@/lib/markets/format';
import type { ReactNode } from 'react';

interface RangeRow {
  floorStrikeUsd: number;
  capStrikeUsd: number;
  rangeBandPct: number;
  /** Implied probability that the asset lands INSIDE [floor, cap]. 0–1. */
  impliedProbUp: number;
  /**
   * Per-row label from the source API (e.g. "$75,000 to $75,250" for
   * Polymarket/Kalshi). When present, the card uses it directly
   * instead of generating "Between $X – $Y" from the floor/cap.
   */
  description?: string | null;
}

interface RangeCardProps {
  asset: string;
  expiryMs: number;
  spotUsd: number | null;
  forwardUsd: number | null;
  /** Range rows (rangeBandPct > 0), in display order. */
  rows: RangeRow[];
  /** Optional eyebrow (e.g. "Polymarket" or "DeepBook Predict"). */
  eyebrow?: ReactNode;
  /**
   * Question from the source API (e.g. "Bitcoin price range on Jun 16, 2026?"
   * for Kalshi/Polymarket). When present, the card uses it as the title;
   * otherwise it falls back to the generated `${asset} price on
   * ${expiryLabel}?`.
   */
  question?: string | null;
  /** Optional click handler for the IN button. */
  onTrade?: (floor: number, cap: number, direction: 'in' | 'out') => void;
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

function RangeButton({
  direction,
  prob,
  onClick,
}: {
  direction: 'in' | 'out';
  prob: number;
  onClick?: () => void;
}) {
  const color = direction === 'in' ? green : red;
  const Icon = direction === 'in' ? Check : X;
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
        className="relative z-10 text-sm font-semibold inline-flex items-center gap-1.5"
        style={{ color }}
      >
        <Icon size={14} strokeWidth={3} />
        {formatPct(prob, 2)}
      </span>
    </button>
  );
}

export default function RangeCard({
  asset,
  expiryMs,
  spotUsd,
  forwardUsd,
  rows,
  eyebrow,
  question,
  onTrade,
}: RangeCardProps) {
  const sortedRows = [...rows].sort((a, b) => a.rangeBandPct - b.rangeBandPct);
  // Title: prefer the API's question (e.g. "Bitcoin price range on Jun 16, 2026?").
  // Fall back to the generated title for sources without an API question.
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

      <div className="mt-1">
        {sortedRows.length === 0 ? (
          <div
            className="text-center text-xs py-8"
            style={{ color: textSecondary }}
          >
            Awaiting oracle data…
          </div>
        ) : (
          sortedRows.map((r) => {
            // Per-row label: prefer the API's description (e.g. "$75,000
            // to $75,250"). Fall back to the generated label for
            // sources that don't carry per-row text (DeepBook).
            const rowLabel =
              r.description && r.description.trim().length > 0
                ? r.description
                : `${formatUsd(r.floorStrikeUsd)} to ${formatUsd(r.capStrikeUsd)}`;
            return (
              <div
                key={r.rangeBandPct}
                className="w-full flex items-center justify-between rounded-xl px-3 py-2 mb-1"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="text-base font-semibold truncate"
                    style={{ color: textPrimary }}
                  >
                    {rowLabel}
                  </span> 
                </div>
                <div className="flex gap-1.5">
                  <RangeButton
                    direction="in"
                    prob={r.impliedProbUp}
                    onClick={() => onTrade?.(r.floorStrikeUsd, r.capStrikeUsd, 'in')}
                  />
                  <RangeButton
                    direction="out"
                    prob={1 - r.impliedProbUp}
                    onClick={() => onTrade?.(r.floorStrikeUsd, r.capStrikeUsd, 'out')}
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
