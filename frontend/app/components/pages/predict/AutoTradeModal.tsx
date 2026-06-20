'use client';

/**
 * AutoTradeModal — preview/confirm the multi-market PTB.
 *
 * Pops on top of `AutoTradePopover` after the user clicks Preview. The
 * popover already owns the slider state and the live order set; this
 * modal is a read-only preview + final confirm.
 *
 * UX (per the approved plan):
 *   - Header: "Auto Trade Preview" + close X.
 *   - Per-trade rows: market · side · strike · amount · cost per unit ·
 *     est. payout (from `getTradeQuote`).
 *   - Quote states: loading skeleton on first fetch, "—" + tooltip on
 *     failure (the on-chain mint still executes regardless).
 *   - Footer: "Total: X DUSDC across N markets" + Cancel + Confirm.
 *   - Confirm runs `usePredict().multiMint(...)` — one atomic PTB.
 *     On `needsManager` (single-bet two-sig precedent), surface a
 *     "Create Manager" CTA that calls `createManager` then retries.
 *   - On success: success toast, `refreshData()` (inside multiMint),
 *     close modal + popover.
 *   - On error: error toast with the on-chain message.
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usePredict } from '@/app/hooks/usePredict';
import { useToast } from '@/app/context/ToastContext';
import { getCoinIcon } from '@/app/lib/coinIcons';
import Countdown from '@/app/components/common/Countdown';
import { formatDusdc, type AutoTradeOrder } from '@/app/lib/auto-trade';
import { formatPrice } from './utils';

const ConnectButton = dynamic(
  () => import('@mysten/dapp-kit-react/ui').then((mod) => mod.ConnectButton),
  { ssr: false },
);

const green = '#00E68A';
const red = '#ef4444';
const amber = '#FFA500';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const DIRECTION_COLOR = { up: green, down: red } as const;

interface AutoTradeModalProps {
  orders: AutoTradeOrder[];
  totalAmount: number;
  onClose: () => void;
}

/** Per-row quote snapshot. `null` = not loaded yet; `undefined` = load failed. */
type QuoteState =
  | { kind: 'loading' }
  | { kind: 'ready'; cost: number; redeem: number; premium: number }
  | { kind: 'failed' };

export default function AutoTradeModal({
  orders,
  totalAmount,
  onClose,
}: AutoTradeModalProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { notify } = useToast();
  const { getTradeQuote, multiMint, createManager, manager } = usePredict();

  const [quotes, setQuotes] = useState<Record<string, QuoteState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Quote fetch — debounced 400ms per the plan, runs whenever the
  // order set shape changes. Per-order failures stay graceful (one row
  // shows "—" but the rest of the table still renders + the on-chain
  // mint proceeds at live pricing regardless).
  useEffect(() => {
    if (orders.length === 0) {
      setQuotes({});
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const initial: Record<string, QuoteState> = {};
      for (const o of orders) initial[o.matchKey] = { kind: 'loading' };
      if (!cancelled) setQuotes(initial);

      const settled = await Promise.all(
        orders.map(async (o) => {
          const q = await getTradeQuote(
            o.oracleId,
            o.expiryMs,
            o.strike,
            o.direction,
            o.amount,
          );
          return [
            o.matchKey,
            q
              ? ({ kind: 'ready', cost: q.cost, redeem: q.redeem, premium: q.premium } as QuoteState)
              : ({ kind: 'failed' } as QuoteState),
          ] as const;
        }),
      );
      if (cancelled) return;
      setQuotes((prev) => {
        const next = { ...prev };
        for (const [k, v] of settled) next[k] = v;
        return next;
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [orders, getTradeQuote]);

  const allQuotesReady = useMemo(
    () => orders.every((o) => quotes[o.matchKey]?.kind === 'ready'),
    [orders, quotes],
  );
  const anyExpired = useMemo(
    () => orders.some((o) => o.expiryMs <= Date.now()),
    [orders],
  );

  const handleConfirm = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction) return;
    if (orders.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await multiMint(dAppKit.signAndExecuteTransaction, orders);
      if ('needsManager' in res) {
        // Two-sig fallback: create manager first, then retry.
        await createManager(dAppKit.signAndExecuteTransaction);
        const retry = await multiMint(dAppKit.signAndExecuteTransaction, orders);
        if ('needsManager' in retry) throw new Error('Manager not ready after creation');
        notify(
          `Auto Trade complete · ${orders.length} market${orders.length === 1 ? '' : 's'} bought, ${formatDusdc(totalAmount)} DUSDC spent.`,
          { variant: 'success', duration: 5000 },
        );
      } else {
        notify(
          `Auto Trade complete · ${orders.length} market${orders.length === 1 ? '' : 's'} bought, ${formatDusdc(totalAmount)} DUSDC spent.`,
          { variant: 'success', duration: 5000 },
        );
      }
      onClose();
    } catch (e: any) {
      const msg = e?.message ?? 'Transaction failed';
      setSubmitError(msg);
      notify(`Auto Trade failed · ${msg}`, { variant: 'error', duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  };

  const submitDisabled =
    submitting ||
    orders.length === 0 ||
    anyExpired ||
    !manager ||
    !account;

  const submitLabel = (() => {
    if (submitting) return 'Submitting…';
    if (!manager) return 'Create Account & Buy';
    return `Confirm · ${formatDusdc(totalAmount)} DUSDC`;
  })();

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div
          className="relative w-full max-w-xl"
          initial={{ scale: 0.95, y: 10, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.95, y: 10, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="relative overflow-hidden rounded-2xl p-5 border border-white/10"
            style={{ background: 'rgba(26, 29, 46, 0.95)', backdropFilter: 'blur(20px)' }}
          >
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

            <div className="relative z-10 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles size={16} style={{ color: green }} />
                  <div className="min-w-0">
                    <h2
                      className="text-base font-bold leading-tight"
                      style={{ color: textPrimary }}
                    >
                      Auto Trade Preview
                    </h2>
                    <p className="text-[11px] mt-0.5" style={{ color: textSecondary }}>
                      AI-filtered batch · {orders.length} market{orders.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
                  style={{ color: textSecondary }}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Per-trade table */}
              <div
                className="rounded-lg border border-white/5 overflow-hidden"
                style={{ background: 'rgba(255, 255, 255, 0.02)' }}
              >
                <div
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider font-semibold"
                  style={{
                    color: textSecondary,
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <span>Market</span>
                  <span className="text-right">Strike</span>
                  <span className="text-right">Cost</span>
                  <span className="text-right">Amount</span>
                </div>

                {orders.length === 0 ? (
                  <div
                    className="p-4 text-[11px] text-center"
                    style={{ color: textSecondary }}
                  >
                    No markets to preview.
                  </div>
                ) : (
                  <ul className="divide-y divide-white/5">
                    {orders.map((o) => {
                      const expired = o.expiryMs <= Date.now();
                      const q = quotes[o.matchKey];
                      const dirColor = DIRECTION_COLOR[o.direction];
                      return (
                        <li
                          key={o.matchKey}
                          className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 items-center"
                          style={{ opacity: expired ? 0.4 : 1 }}
                        >
                          {/* Market + side + expiry */}
                          <div className="min-w-0 flex items-center gap-2">
                            <Image
                              src={getCoinIcon(o.asset)}
                              alt={o.asset}
                              width={18}
                              height={18}
                              className="rounded-full shrink-0"
                            />
                            <div className="min-w-0">
                              <div
                                className="text-[11px] font-mono font-semibold truncate flex items-center gap-1.5"
                                style={{ color: textPrimary }}
                              >
                                <span>{o.asset}/USD</span>
                                <span style={{ color: dirColor }}>
                                  {o.direction === 'up' ? '▲' : '▼'}
                                </span>
                                {!expired ? (
                                  <Countdown expiryMs={o.expiryMs} />
                                ) : (
                                  <span style={{ color: red }} className="text-[9px] uppercase">
                                    expired
                                  </span>
                                )}
                              </div>
                              <div
                                className="font-mono text-[10px]"
                                style={{ color: textSecondary }}
                              >
                                {Math.round(o.confidence * 100)}% conf
                              </div>
                            </div>
                          </div>

                          {/* Strike */}
                          <div
                            className="text-right font-mono text-[11px] font-semibold"
                            style={{ color: textPrimary }}
                          >
                            {formatPrice(o.strike)}
                          </div>

                          {/* Cost (from quote, "—" on failure) */}
                          <div
                            className="text-right font-mono text-[11px]"
                            style={{ color: textSecondary }}
                            title={
                              q?.kind === 'ready'
                                ? `Cost per unit ${q.cost.toFixed(4)} · redeem ${q.redeem.toFixed(4)} · premium ${q.premium.toFixed(4)}`
                                : 'Quote unavailable — on-chain mint will use live pricing'
                            }
                          >
                            {q?.kind === 'ready' ? (
                              `$${q.cost.toFixed(4)}`
                            ) : q?.kind === 'loading' ? (
                              <Loader2
                                size={11}
                                className="inline-block animate-spin"
                                style={{ color: textSecondary }}
                              />
                            ) : (
                              '—'
                            )}
                          </div>

                          {/* Amount */}
                          <div
                            className="text-right font-mono text-[11px] font-semibold"
                            style={{ color: textPrimary }}
                          >
                            {formatDusdc(o.amount)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Total footer */}
                {orders.length > 0 && (
                  <div
                    className="flex items-center justify-between px-3 py-2"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: textSecondary }}>
                      Total · {orders.length} market{orders.length === 1 ? '' : 's'}
                    </span>
                    <span
                      className="font-mono text-[12px] font-bold"
                      style={{ color: green }}
                    >
                      {formatDusdc(totalAmount)} DUSDC
                    </span>
                  </div>
                )}
              </div>

              {/* Warning row */}
              {anyExpired && (
                <p className="text-[10px]" style={{ color: amber }}>
                  One or more markets expired while the modal was open. Refresh the popover and try again.
                </p>
              )}

              {/* Submit error */}
              {submitError && (
                <div
                  className="rounded-md p-2.5 text-xs"
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
                    Connect wallet to submit Auto Trade
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleConfirm}
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
                    {!submitting && !manager && <CheckCircle2 size={14} />}
                    {!submitting && manager && <ChevronRight size={14} />}
                    {submitLabel}
                  </button>
                  <p
                    className="text-[10px] text-center leading-relaxed"
                    style={{ color: textSecondary }}
                  >
                    One atomic PTB: deposit + {orders.length} mint{orders.length === 1 ? '' : 's'}. Wallet covers the full {formatDusdc(totalAmount)} DUSDC.
                  </p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}