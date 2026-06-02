'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usePredict } from '../../../hooks/usePredict';
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

interface BinaryTradeModalProps {
  open: boolean;
  onClose: () => void;
  market: {
    oracleId: string;
    asset: string;
    expiryMs: number;
    spotUsd: number;
  };
  strike: number;
  initialDirection: 'up' | 'down';
}

export default function BinaryTradeModal({
  open,
  onClose,
  market,
  strike,
  initialDirection,
}: BinaryTradeModalProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { mint, getTradeQuote, manager } = usePredict();

  const [direction, setDirection] = useState<'up' | 'down'>(initialDirection);
  const [amount, setAmount] = useState('1');
  const [upQuote, setUpQuote] = useState<{ cost: number; redeem: number; premium: number } | null>(null);
  const [downQuote, setDownQuote] = useState<{ cost: number; redeem: number; premium: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setDirection(initialDirection);
      setAmount('1');
      setUpQuote(null);
      setDownQuote(null);
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [open, initialDirection]);

  // Quote polling
  const quoteKey = `${open}|${market.oracleId}|${market.expiryMs}|${strike}|${amount}`;
  useEffect(() => {
    if (!open || !getTradeQuote || !market.oracleId || !market.expiryMs || strike <= 0) {
      return;
    }
    const qty = parseFloat(amount) > 0 ? parseFloat(amount) : 1;
    let cancelled = false;
    const fetchQuotes = async () => {
      try {
        const [up, down] = await Promise.all([
          getTradeQuote(market.oracleId, market.expiryMs, strike, 'up', qty),
          getTradeQuote(market.oracleId, market.expiryMs, strike, 'down', qty),
        ]);
        if (cancelled) return;
        setUpQuote(up);
        setDownQuote(down);
      } catch (e) {
        console.error('Quote fetch failed:', e);
      }
    };
    fetchQuotes();
    const intervalMs = upQuote === null ? 1000 : 3000;
    const id = setInterval(fetchQuotes, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, getTradeQuote]);

  const roundedAmount = parseFloat(amount) || 0;
  const activeQuote = direction === 'up' ? upQuote : downQuote;
  const costPer = activeQuote?.cost ?? 0;
  const premiumPer = activeQuote?.premium ?? 0;
  const payoutIfWin = costPer > 0 ? (1 + (1 - costPer - premiumPer)) * roundedAmount : 0;
  const profitIfWin = payoutIfWin - roundedAmount;
  const hasQuote = activeQuote !== null;

  const handleSubmit = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction || roundedAmount < 0.01) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await mint(
        dAppKit.signAndExecuteTransaction,
        market.oracleId,
        market.expiryMs,
        strike,
        direction,
        roundedAmount
      );
      onClose();
    } catch (e: any) {
      setSubmitError(e?.message ?? 'Transaction failed');
    } finally {
      setSubmitting(false);
    }
  };

  const question = `Will ${market.asset} be ${direction === 'up' ? 'above' : 'below'} ${formatPrice(strike)}?`;

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
                      {market.expiryMs > 0 && (
                        <p className="text-xs mt-1" style={{ color: textSecondary }}>
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

                {/* Direction toggle */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {(['up', 'down'] as const).map((d) => {
                    const isActive = direction === d;
                    const quote = d === 'up' ? upQuote : downQuote;
                    const color = d === 'up' ? green : red;
                    const pricePer = quote?.cost ?? null;
                    return (
                      <button
                        key={d}
                        onClick={() => setDirection(d)}
                        className="relative rounded-xl px-3 py-3 overflow-hidden border transition-all"
                        style={{
                          background: isActive
                            ? d === 'up'
                              ? 'rgba(0, 230, 138, 0.12)'
                              : 'rgba(239, 68, 68, 0.12)'
                            : 'rgba(255, 255, 255, 0.04)',
                          borderColor: isActive ? color : 'rgba(255, 255, 255, 0.1)',
                        }}
                      >
                        <div
                          className="absolute -top-6 -right-6 w-16 h-16 rounded-full"
                          style={{
                            background: color,
                            filter: 'blur(30px)',
                            opacity: isActive ? 0.25 : 0.08,
                          }}
                        />
                        <div className="relative z-10 flex flex-col items-center gap-1">
                          <span
                            className="text-sm font-bold"
                            style={{ color: isActive ? color : textSecondary }}
                          >
                            {d === 'up' ? '▲ UP' : '▼ DOWN'}
                          </span>
                          <span
                            className="text-xs font-mono"
                            style={{ color: isActive ? color : textSecondary }}
                          >
                            {pricePer !== null ? `$${pricePer.toFixed(4)}` : '—'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
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
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
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
                  <div
                    className="text-center py-3 rounded-lg text-xs"
                    style={{ background: 'rgba(255, 255, 255, 0.04)', color: textSecondary }}
                  >
                    Create a manager to start trading
                  </div>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || roundedAmount < 0.01 || !hasQuote}
                    className="w-full py-3 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2"
                    style={{
                      background: hasQuote && roundedAmount >= 0.01 ? green : 'rgba(255, 255, 255, 0.08)',
                      color: hasQuote && roundedAmount >= 0.01 ? '#000' : textSecondary,
                      opacity: submitting ? 0.6 : 1,
                      cursor: submitting || !hasQuote ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {submitting && <Loader2 size={14} className="animate-spin" />}
                    {submitting
                      ? 'Submitting…'
                      : !hasQuote
                        ? 'Fetching quote…'
                        : `Place ${direction === 'up' ? '▲ UP' : '▼ DOWN'} bet`}
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
