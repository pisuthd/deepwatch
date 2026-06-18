'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usePredict, DUSDC_SCALE, type RangeQuote } from '../../../hooks/usePredict';
import { useToast } from '../../../context/ToastContext';
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
  const { notify } = useToast();
  const { mintRange, createManagerAndMintRange, getRangeQuote, manager, walletDusdcBalance } = usePredict();

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

  // Wallet DBUSDC balance — the actual funding source for the range bet.
  // The bet is paid by pulling the full amount out of the wallet and
  // depositing it into the PredictManager in the same atomic PTB; the modal
  // only needs to know how much the user has in their wallet.
  const walletBalanceHuman = Number(walletDusdcBalance) / Number(DUSDC_SCALE);
  const insufficientWallet = walletBalanceHuman < roundedAmount;
  const walletShortfall = Math.max(0, roundedAmount - walletBalanceHuman);

  const handleSubmit = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction || roundedAmount < 0.01) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (manager) {
        // Single atomic PTB: pull the full bet from the wallet, deposit into
        // the manager, mint the range position. Wallet must cover the full
        // amount.
        await mintRange(
          dAppKit.signAndExecuteTransaction,
          market.oracleId,
          market.expiryMs,
          lower,
          upper,
          roundedAmount
        );
        notify(
          `Range bet placed · ${formatPrice(lower)}–${formatPrice(upper)}`,
          { variant: 'success', duration: 4000 }
        );
      } else {
        // No manager yet. Single-PTB create_manager + deposit + mint_range.
        await createManagerAndMintRange(
          dAppKit.signAndExecuteTransaction,
          market.oracleId,
          market.expiryMs,
          lower,
          upper,
          roundedAmount
        );
        notify(
          `Account created · Range ${formatPrice(lower)}–${formatPrice(upper)}`,
          { variant: 'success', duration: 4000 }
        );
      }
      onClose();
    } catch (e: any) {
      setSubmitError(e?.message ?? 'Transaction failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Single submit-button label. The wallet→PredictManager deposit is always
  // part of the PTB, so we no longer show a separate "Deposit $X" step.
  const submitLabel = (() => {
    if (submitting) return 'Submitting…';
    if (!hasQuote) return 'Fetching quote…';
    if (!manager) return 'Create Account & Place Bet';
    return 'Place RANGE bet';
  })();

  // Submit disabled state mirrors the label's pre-conditions.
  const submitDisabled =
    submitting ||
    roundedAmount < 0.01 ||
    !hasQuote ||
    insufficientWallet;

  const question = `${market.asset} price range ${formatPrice(lower)}-${formatPrice(upper)}?`;
 
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
                <div className="flex items-start justify-between gap-3 mb-3">
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
                      {market.expiryMs > 0 && (
                        <p className="text-[11px] mt-0.5" style={{ color: textSecondary }}>
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
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs" style={{ color: textSecondary }}>
                      Amount
                    </label>
                    {!!account && (
                      <span className="text-[10px]" style={{ color: textSecondary }}>
                        Available:{' '}
                        <span className="font-mono" style={{ color: textPrimary }}>
                          {walletBalanceHuman.toFixed(2)} DUSDC
                        </span>
                      </span>
                    )}
                  </div>
                  <div
                    className="flex items-center gap-2 rounded-lg overflow-hidden px-3"
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    <Image
                      src={getCoinIcon('USDC')}
                      alt="USDC"
                      width={16}
                      height={16}
                      className="rounded-full shrink-0"
                    />
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="1"
                      step="0.01"
                      min="0.01"
                      className="flex-1 py-2.5 bg-transparent text-sm font-mono text-white outline-none"
                    />
                    <span className="text-xs font-mono" style={{ color: textSecondary }}>
                      DUSDC
                    </span>
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
                            background: isActive ? 'rgba(0, 230, 138, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                            border: `1px solid ${isActive ? 'rgba(0, 230, 138, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                            color: isActive ? green : textSecondary,
                          }}
                        >
                          {p}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setAmount(walletBalanceHuman > 0 ? walletBalanceHuman.toFixed(6).replace(/\.?0+$/, '') : '0')}
                      disabled={walletBalanceHuman <= 0}
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
                          style={{ color: green }}
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
                ) : (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={handleSubmit}
                      disabled={submitDisabled}
                      className="w-full py-3 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2"
                      style={{
                        background: !submitDisabled ? green : 'rgba(255, 255, 255, 0.08)',
                        color: !submitDisabled ? '#000' : textSecondary,
                        opacity: submitting ? 0.6 : 1,
                        cursor: submitDisabled ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {submitting && <Loader2 size={14} className="animate-spin" />}
                      {submitLabel}
                    </button>
                    {insufficientWallet && (
                      <p
                        className="text-[11px] text-center"
                        style={{ color: red }}
                      >
                        Need {walletShortfall.toFixed(2)} more DUSDC in your wallet.{' '}
                        <a
                          href="https://tally.so/r/Xx102L"
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                          style={{ color: red }}
                        >
                          Get from faucet
                        </a>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}