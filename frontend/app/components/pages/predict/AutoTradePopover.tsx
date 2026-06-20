'use client';

/**
 * AutoTradePopover — sliders + live-filtered list of AI-picked markets.
 *
 * Anchored `bottom-full mb-2 right-0` on the trailing `AutoTradeButton`,
 * same visual language as `MatchInsightPopover` (dark glass card with
 * green accent).
 *
 * UX (per the approved plan):
 *   - Header: title + close + small freshness badge ("from batch 8a3f…").
 *   - Three controls:
 *       * Confidence threshold slider (0–100%, default 50%)
 *       * Total budget slider (0.1–100 DUSDC, default 10)
 *       * Max markets stepped control (1–10, default 5)
 *   - Live list: re-derives on every slider change, capped at
 *     `maxMarkets`. Each row: asset/USD · expiry, side (color-coded),
 *     strike, allocated amount.
 *   - Staker gate: if `!isStaker`, show the `LockedCta` (copied from
 *     MatchInsightPopover) with a "Stake PLP to unlock" link.
 *   - Footer: Cancel + Preview (disabled on no orders / over budget).
 *
 * The Preview button opens `AutoTradeModal` for the per-trade quote
 * fetch + final confirm. The popover itself is read-only — it does
 * NOT fire the PTB.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronUp, Lock, Wand2, X } from 'lucide-react';
import { useMarkets } from '@/app/hooks/useMarkets';
import { useStake } from '@/app/hooks/useStake';
import { usePredict } from '@/app/hooks/usePredict';
import { useAutoTrade } from '@/app/hooks/useAutoTrade';
import { formatDusdc } from '@/app/lib/auto-trade';
import AutoTradeModal from './AutoTradeModal';

const green = '#00E68A';
const red = '#ef4444';
const amber = '#FFA500';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const DIRECTION_COLOR = { up: green, down: red } as const;

interface AutoTradePopoverProps {
  onClose: () => void;
}

export default function AutoTradePopover({ onClose }: AutoTradePopoverProps) {
  const { markets } = useMarkets();
  const { isStaker, isReady: stakeReady } = useStake();
  const { walletDusdcBalance, manager } = usePredict();

  const [thresholdPct, setThresholdPct] = useState<number>(50);
  const [budget, setBudget] = useState<number>(10);
  const [maxMarkets, setMaxMarkets] = useState<number>(5);
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  const { orders, totalAmount, latestBatchId } = useAutoTrade(markets, {
    confidenceThresholdPct: thresholdPct,
    budget,
    maxMarkets,
  });

  const walletBalanceHuman = useMemo(
    () => Number(walletDusdcBalance) / 1e6,
    [walletDusdcBalance],
  );

  const overBudget = budget > walletBalanceHuman;
  const canPreview = orders.length > 0 && !overBudget && !!manager;
  const showStakerGate = stakeReady && !isStaker;

  return (
    <>
      <div
        className="absolute bottom-full mb-2 right-0 z-40 w-[420px] rounded-2xl border border-white/10 overflow-hidden"
        style={{
          background: 'rgba(26, 29, 46, 0.95)',
          backdropFilter: 'blur(20px)',
        }}
        role="dialog"
        aria-label="Auto trade"
      >
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

        <div className="relative z-10 p-4 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Wand2 size={14} style={{ color: green }} />
              <h3 className="text-sm font-bold" style={{ color: textPrimary }}>
                Auto Trade
              </h3>
              {latestBatchId && (
                <span
                  className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    background: 'rgba(0, 230, 138, 0.12)',
                    color: green,
                  }}
                  title={`Latest batch id: ${latestBatchId}`}
                >
                  batch · {latestBatchId.slice(0, 6)}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors hover:bg-white/10"
              style={{ color: textSecondary }}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {/* Staker gate */}
          {showStakerGate ? (
            <LockedCta />
          ) : (
            <>
              {/* Sliders */}
              <div className="space-y-3">
                <SliderRow
                  label="Confidence threshold"
                  valueLabel={`≥ ${thresholdPct}%`}
                >
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={thresholdPct}
                    onChange={(e) => setThresholdPct(Number(e.target.value))}
                    className="w-full accent-[#00E68A]"
                    aria-label="Minimum AI confidence percent"
                  />
                </SliderRow>

                <SliderRow
                  label="Total budget"
                  valueLabel={`${formatDusdc(budget)} DUSDC`}
                  valueColor={overBudget ? red : undefined}
                  hint={
                    overBudget
                      ? `Wallet has ${formatDusdc(walletBalanceHuman)} DUSDC — lower the budget.`
                      : `Spreads across ${orders.length} market${orders.length === 1 ? '' : 's'} (wallet: ${formatDusdc(walletBalanceHuman)} DUSDC).`
                  }
                >
                  <input
                    type="range"
                    min={0.1}
                    max={100}
                    step={0.5}
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                    className="w-full accent-[#00E68A]"
                    aria-label="Total budget in DUSDC"
                  />
                </SliderRow>

                <SliderRow
                  label="Max markets"
                  valueLabel={`${maxMarkets}`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={maxMarkets}
                      onChange={(e) => setMaxMarkets(Number(e.target.value))}
                      className="flex-1 accent-[#00E68A]"
                      aria-label="Maximum markets"
                    />
                  </div>
                </SliderRow>
              </div>

              {/* Live list */}
              <div
                className="rounded-lg border border-white/5 max-h-[260px] overflow-y-auto"
                style={{ background: 'rgba(255,255,255,0.02)' }}
              >
                {orders.length === 0 ? (
                  <div
                    className="p-3 text-[11px] text-center"
                    style={{ color: textSecondary }}
                  >
                    No markets match this threshold. Lower the confidence or increase max markets.
                  </div>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {orders.map((o) => (
                      <li key={o.matchKey} className="px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div
                            className="text-[11px] font-mono font-semibold truncate"
                            style={{ color: textPrimary }}
                          >
                            {o.asset}/USD · {fmtExpiry(o.expiryMs)}
                          </div>
                          <div
                            className="font-mono text-[10px]"
                            style={{ color: textSecondary }}
                          >
                            <span style={{ color: DIRECTION_COLOR[o.direction] }}>
                              {o.direction === 'up' ? '▲ UP' : '▼ DOWN'}
                            </span>
                            {' · '}
                            {Math.round(o.confidence * 100)}% conf
                            {' · K='}
                            {Math.round(o.strike).toLocaleString()}
                          </div>
                        </div>
                        <div
                          className="font-mono text-[11px] font-semibold shrink-0"
                          style={{ color: textPrimary }}
                        >
                          {formatDusdc(o.amount)} DUSDC
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {!manager && (
                <p
                  className="text-[10px]"
                  style={{ color: amber }}
                  title="Predict Manager is the on-chain account that holds your DUSDC and positions."
                >
                  Predict Manager required — create one before submitting.
                </p>
              )}

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors hover:bg-white/5"
                  style={{ color: textSecondary }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canPreview}
                  onClick={() => setModalOpen(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-opacity disabled:opacity-40 hover:opacity-90"
                  style={{
                    background: green,
                    color: '#0a0e1a',
                  }}
                >
                  <ChevronUp size={12} />
                  Preview
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {modalOpen && (
        <AutoTradeModal
          orders={orders}
          totalAmount={totalAmount}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function SliderRow({
  label,
  valueLabel,
  valueColor,
  hint,
  children,
}: {
  label: string;
  valueLabel: string;
  valueColor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: textSecondary }}
        >
          {label}
        </span>
        <span
          className="font-mono font-semibold"
          style={{ color: valueColor ?? textPrimary, fontSize: 11 }}
        >
          {valueLabel}
        </span>
      </div>
      {children}
      {hint && (
        <p className="text-[10px]" style={{ color: textSecondary }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function LockedCta() {
  return (
    <div className="space-y-3 py-1">
      <div className="flex items-center gap-2">
        <Lock size={14} style={{ color: amber }} />
        <div
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: amber }}
        >
          Subscription required
        </div>
      </div>
      <p
        className="text-[11px] leading-relaxed"
        style={{ color: textSecondary }}
      >
        Auto Trade reads the AI batch insights — encrypted behind the
        DeepWatch stake gate. Stake PLP to unlock it (first 3 markets
        per batch stay free).
      </p>
      <Link
        href="/app/stake"
        className="inline-flex items-center justify-center w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-90"
        style={{ background: green, color: '#0a0e1a' }}
      >
        Stake PLP to unlock
      </Link>
    </div>
  );
}

function fmtExpiry(expiryMs: number): string {
  const diffMs = expiryMs - Date.now();
  if (diffMs <= 0) return 'expired';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}