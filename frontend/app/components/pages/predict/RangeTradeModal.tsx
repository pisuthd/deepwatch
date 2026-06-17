'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usePredict, DUSDC_SCALE, type RangeQuote } from '../../../hooks/usePredict';
import { getCoinIcon } from '../../../lib/coinIcons';
import Countdown from '../../common/Countdown';
import { formatPrice } from './utils';

const ConnectButton = dynamic(
  () => import('@mysten/dapp-kit-react/ui').then((mod) => mod.ConnectButton),
  { ssr: false }
);

const PRESETS = [1, 5, 10, 25];

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const cyan = '#3EC4C0';

interface RangeTradeModalProps {
  open: boolean;
  onClose: () => void;
  market: {
    oracleId: string;
    asset: string;
    expiryMs: number;
    spotUsd: number;
  };
  lower: number;
  upper: number;
  /** Strike the user picked as the band center (for ±$X copy). */
  triggerStrike: number;
  /** Half-width of the band in USD (for ±$X copy). */
  widthUsd: number;
}

export default function RangeTradeModal({
  open,
  onClose,
  market,
  lower,
  upper,
  triggerStrike,
  widthUsd,
}: RangeTradeModalProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { mintRange, getRangeQuote, manager, summary } = usePredict();

  const [amount, setAmount] = useState('1');
  const [rangeQuote, setRangeQuote] = useState<RangeQuote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setAmount('1');
      setRangeQuote(null);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [open]);

  // Quote polling. Polls at 1s until the first quote lands, then 3s —
  // matches the cadence used by BinaryTradeModal.
  const quoteKey = `${open}|${market.oracleId}|${market.expiryMs}|${lower}|${upper}|${amount}`;
  useEffect(() => {
    if (!open || !getRangeQuote || !market.oracleId || !market.expiryMs || lower <= 0 || upper <= 0) {
      return;
    }
    const qty = parseFloat(amount) > 0 ? parseFloat(amount) : 1;
    let cancelled = false;
    const fetchQuote = async () => {
      try {
        const q = await getRangeQuote(market.oracleId, market.expiryMs, lower, upper, qty);
        if (cancelled) return;
        setRangeQuote(q);
      } catch (e) {
        console.error('Range quote fetch failed:', e);
      }
    };
    fetchQuote();
    const intervalMs = rangeQuote === null ? 1000 : 3000;
    const id = setInterval(fetchQuote, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, getRangeQuote]);

  const roundedAmount = parseFloat(amount) || 0;
  // RangeQuote.{cost,payout} are per-unit DBUSDC (already divided by quantity).
  const costPer = rangeQuote?.cost ?? 0;
  const payoutPer = rangeQuote?.payout ?? 0;
  const costTotal = costPer * roundedAmount;
  const payoutIfWin = payoutPer * roundedAmount;
  const profitIfWin = payoutIfWin - costTotal;
  const hasQuote = rangeQuote !== null;

  // Predict-Manager trading balance (DBUSDC)
  const balanceDusdc = summary ? Number(summary.trading_balance) / Number(DUSDC_SCALE) : 0;
  const needsDeposit = !!manager && balanceDusdc <= 0;
  const insufficient = !!manager && roundedAmount > balanceDusdc;

  const handleSubmit = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction || roundedAmount < 0.01) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await mintRange(
        dAppKit.signAndExecuteTransaction,
        market.oracleId,
        market.expiryMs,
        lower,
        upper,
        roundedAmount
      );
      onClose();
    } catch (e: any) {
      setSubmitError(e?.message ?? 'Transaction failed');
    } finally {
      setSubmitting(false);
    }
  };

  const question = `Will ${market.asset} settle between ${formatPrice(lower)} and ${formatPrice(upper)}?`;
  const rangeSummary =
    widthUsd > 0
      ? `±$${widthUsd.toLocaleString('en-US')} around ${formatPrice(triggerStrike)}`
      : `${formatPrice(lower)}–${formatPrice(upper)}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            className="relative w-full max-w-md"
            initial={{ scale: 0.95, y: 10, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 10, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="relative overflow-hidden rounded-2xl p-5 border border-white/10"
              style={{ background: 'rgba(26, 29, 46, 0.95)', backdropFilter: 'blur(20px)' }}
            >
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent" />
              <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

              <div className="relative z-10">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Image
                      src={getCoinIcon(market.asset)}
                      alt={market.asset}
                      width={28}
                      height={28}
                      className="rounded-full shrink-0 mt-0.5"
                    />
                    <div className="min-w-0">
                      <h2 className="text-base font-bold leading-tight" style={{ color: textPrimary }}>
                        {question}
                      </h2>
                      <p className="text-xs mt-1" style={{ color: textSecondary }}>
                        Range · {rangeSummary}
                      </p>
                      {market.expiryMs > 0 && (
                        <p className="text-xs mt-0.5" style={{ color: textSecondary }}>
                          Expires in <Countdown expiryMs={market.expiryMs} />
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
                    style={{ color: textSecondary }}
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Amount input */}
                <div className="mb-3">
                  <label className="text-xs mb-1.5 block" style={{ color: textSecondary }}>
                    Amount (DBUSDC)
                  </label>
                  <div
                    className="flex items-center rounded-lg overflow-hidden"
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="1"
                      step="0.01"
                      min="0.01"
                      className="flex-1 px-3 py-2.5 bg-transparent text-sm font-mono text-white outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 mt-2">
                    {PRESETS.map((p) => {
                      const isActive = roundedAmount === p;
                      return (
                        <button
                          key={p}
                          onClick={() => setAmount(String(p))}
                          className="py-1.5 rounded-md text-xs font-mono font-semibold transition-colors"
                          style={{
                            background: isActive ? 'rgba(62, 196, 192, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                            border: `1px solid ${isActive ? 'rgba(62, 196, 192, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                            color: isActive ? cyan : textSecondary,
                          }}
                        >
                          ${p}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setAmount(balanceDusdc > 0 ? balanceDusdc.toFixed(6).replace(/\.?0+$/, '') : '0')}
                      disabled={balanceDusdc <= 0}
                      className="py-1.5 rounded-md text-xs font-mono font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        color: textSecondary,
                      }}
                    >
                      MAX
                    </button>
                  </div>
                  {!!manager && (
                    <div className="flex items-center justify-between mt-2 text-[10px]" style={{ color: textSecondary }}>
                      <span>Available</span>
                      <span className="font-mono" style={{ color: textPrimary }}>
                        ${balanceDusdc.toFixed(2)} DBUSDC
                      </span>
                    </div>
                  )}
                </div>

                {/* Payout details */}
                {roundedAmount > 0 && hasQuote && (
                  <div
                    className="rounded-lg p-3 mb-3"
                    style={{ background: 'rgba(255, 255, 255, 0.04)' }}
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                          Payout if win
                        </div>
                        <div
                          className="text-base font-mono font-bold mt-0.5"
                          style={{ color: cyan }}
                        >
                          ${payoutIfWin.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                          Profit
                        </div>
                        <div
                          className="text-base font-mono font-bold mt-0.5"
                          style={{ color: profitIfWin >= 0 ? green : red }}
                        >
                          {profitIfWin >= 0 ? '+' : ''}${profitIfWin.toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <div
                      className="flex items-center justify-between mt-2 pt-2 text-[10px]"
                      style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: textSecondary }}
                    >
                      <span>Cost per unit</span>
                      <span className="font-mono" style={{ color: textPrimary }}>
                        ${costPer.toFixed(4)}
                      </span>
                    </div>
                  </div>
                )}

                {submitError && (
                  <div
                    className="rounded-md p-2.5 mb-3 text-xs"
                    style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
                  >
                    {submitError}
                  </div>
                )}

                {/* Submit area */}
                {!account ? (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <ConnectButton />
                    <p className="text-xs" style={{ color: textSecondary }}>
                      Connect wallet to place a bet
                    </p>
                  </div>
                ) : !manager ? (
                  <Link
                    href="/overview"
                    onClick={onClose}
                    className="block text-center py-3 rounded-lg text-xs font-semibold transition-colors hover:bg-white/[0.06]"
                    style={{
                      background: 'rgba(62, 196, 192, 0.12)',
                      border: '1px solid rgba(62, 196, 192, 0.35)',
                      color: cyan,
                    }}
                  >
                    Create your Predict account at Overview →
                  </Link>
                ) : needsDeposit ? (
                  <div className="flex flex-col gap-2">
                    <Link
                      href="/overview"
                      onClick={onClose}
                      className="block text-center py-3 rounded-lg text-xs font-semibold transition-colors hover:bg-white/[0.06]"
                      style={{
                        background: 'rgba(62, 196, 192, 0.12)',
                        border: '1px solid rgba(62, 196, 192, 0.35)',
                        color: cyan,
                      }}
                    >
                      Deposit DBUSDC at Overview →
                    </Link>
                    <p className="text-[11px] text-center" style={{ color: textSecondary }}>
                      Your Predict account has no balance. Deposit DBUSDC to start betting.
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || roundedAmount < 0.01 || !hasQuote || insufficient}
                    className="w-full py-3 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2"
                    style={{
                      background: hasQuote && roundedAmount >= 0.01 && !insufficient ? green : 'rgba(255, 255, 255, 0.08)',
                      color: hasQuote && roundedAmount >= 0.01 && !insufficient ? '#000' : textSecondary,
                      opacity: submitting ? 0.6 : 1,
                      cursor: submitting || !hasQuote || insufficient ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {submitting && <Loader2 size={14} className="animate-spin" />}
                    {submitting
                      ? 'Submitting…'
                      : !hasQuote
                        ? 'Fetching quote…'
                        : insufficient
                          ? 'Insufficient balance'
                          : 'Place RANGE bet'}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}