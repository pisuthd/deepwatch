'use client';

/**
 * PoolCard — minimal "lending-pool style" card for the /app/stake
 * Pools tab.
 *
 * Two cards are rendered side-by-side (responsive: stack on mobile):
 *   1. DeepBook Predict Vault — DUSDC ↔ PLP via Predict
 *   2. DeepWatch Subscription Vault — PLP ↔ Subscription NFT
 *
 * The card is intentionally discovery / decision surface only. The
 * full deposit / withdraw / stake / unstake flow lives in a modal that
 * opens when the user clicks the CTA — see LpProvisionModal and
 * PoolStakeModal. This keeps the Pools tab scannable: name, big
 * top-right metric, optional extra details, share price, total
 * supplied.
 *
 * The CTA is the only interactive surface of the card. The whole-card
 * click target is intentionally out of scope (would need card-as-button
 * semantics — easier to a11y-test later if/when added).
 */

import type { ReactNode } from 'react';
import GlassCard from '../../common/GlassCard';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';
const green = '#00E68A';

export interface PoolCardDetail {
  label: string;
  value: ReactNode;
}

export interface PoolCardMetric {
  /** Big value rendered top-right of the card (e.g. "0.35%"). */
  value: string;
  /** Small label below the value (e.g. "Max payout utilization"). */
  label: string;
}

export interface PoolCardProps {
  /** Top-left icon. Can be a lucide icon, a Next/Image, or any node. */
  icon: ReactNode;
  name: string;
  /** One-line subtitle under the name (e.g. "Deposit DUSDC → mint PLP"). */
  subtitle: string;
  /** Optional top-right big stat. When omitted the header is just
   * icon + name + subtitle, full-width. */
  metric?: PoolCardMetric;
  /** Optional extra rows in the metric grid (e.g. "Asset: DUSDC"
   * with an image icon, or "Lockup: 7 / 30 / 90 days"). */
  details?: PoolCardDetail[];
  /** Pre-formatted share price string (e.g. "$1.0234"). Pass null for "—". */
  sharePrice: string | null;
  /** Pre-formatted total supplied string (e.g. "$1.42M"). Pass null for "—". */
  totalSupplied: string | null;
  /** Label on the primary CTA (e.g. "Deposit DUSDC → PLP"). */
  ctaLabel: string;
  onCtaClick: () => void;
  /** Optional disabled state (e.g. when the underlying pool isn't deployed). */
  disabled?: boolean;
  /** Tooltip shown on the CTA when disabled. */
  disabledReason?: string;
}

export default function PoolCard({
  icon,
  name,
  subtitle,
  metric,
  details,
  sharePrice,
  totalSupplied,
  ctaLabel,
  onCtaClick,
  disabled = false,
  disabledReason,
}: PoolCardProps) {
  return (
    <GlassCard className="flex flex-col gap-3" overflow="hidden">
      {/* Header row: icon + name + subtitle (left) + big metric (right) */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
          // style={{
          //   background: 'rgba(0, 230, 138, 0.12)',
          //   border: '1px solid rgba(0, 230, 138, 0.25)',
          //   color: green,
          // }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="text-base font-bold leading-tight"
            style={{ color: textPrimary }}
          >
            {name}
          </div>
          <div
            className="text-[11px] leading-snug mt-0.5"
            style={{ color: textSecondary }}
          >
            {subtitle}
          </div>
        </div>

        {/* Top-right metric — flex-shrink-0 so the long name can wrap. */}
        {metric && (
          <div className="shrink-0 text-right">
            <div
              className="text-2xl font-mono font-bold leading-none"
              style={{ color: textPrimary }}
            >
              {metric.value}
            </div>
            <div
              className="text-[10px] uppercase tracking-wide mt-1 max-w-[120px] leading-tight"
              style={{ color: textSecondary }}
            >
              {metric.label}
            </div>
          </div>
        )}
      </div>

      {/* Metric grid — extra detail rows first (Asset, Lockup, etc.),
          then the standard share price / total supplied. */}
      {(details && details.length > 0) || true ? (
        <div className="border-t mt-4 border-white/8 pt-2.5 space-y-1.5">
          {details?.map((d, i) => (
            <DetailRow key={i} label={d.label} value={d.value} />
          ))}
          <MetricRow label="PLP share price" value={sharePrice ?? '—'} />
          <MetricRow label="Total supplied" value={totalSupplied ?? '—'} />
        </div>
      ) : null}

      {/* CTA */}
      <button
        type="button"
        onClick={onCtaClick}
        disabled={disabled}
        title={disabled ? disabledReason : ctaLabel}
        className="w-full mt-4 inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: green,
          color: '#000',
        }}
      >
        {ctaLabel}
      </button>
    </GlassCard>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span
        className="text-[11px] uppercase tracking-wide"
        style={{ color: textMuted }}
      >
        {label}
      </span>
      <span
        className="text-sm font-mono font-semibold"
        style={{ color: textPrimary }}
      >
        {value}
      </span>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className="text-[11px] uppercase tracking-wide"
        style={{ color: textMuted }}
      >
        {label}
      </span>
      <span className="text-sm font-mono font-semibold" style={{ color: textPrimary }}>
        {value}
      </span>
    </div>
  );
}
