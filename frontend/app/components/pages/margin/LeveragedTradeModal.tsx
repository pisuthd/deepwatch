'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useMargin } from '../../../hooks/useMargin';
import { useDeepbook } from '../../../hooks/useDeepbook';
import { useToast } from '../../../context/ToastContext';
import type { MarginMarket } from '../../../lib/marginMarkets';

interface LeveragedTradeModalProps {
  market: MarginMarket;
  managerId: string;
  onClose: () => void;
}

type Side = 'long' | 'short';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';

/**
 * Leveraged long/short modal for an existing MarginManager. The user picks
 * the leverage (1×–5×), the amount to trade (in base or quote), and the
 * side. Internally we compose a borrow → withdraw → swap PTB (or the
 * reverse for shorts) and transfer the resulting asset to the wallet.
 *
 * Slippage is applied as 1% below the spot quote for the protection of the
 * user; this is conservative given the AMM nature of DeepBook pools.
 */
export default function LeveragedTradeModal({
  market,
  managerId,
  onClose,
}: LeveragedTradeModalProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { leveragedLong, leveragedShort } = useMargin();
  const { getBaseOut, getQuoteOut } = useDeepbook();
  const { notify } = useToast();

  const poolKey = market.market.replace('/', '_') as string;

  const [side, setSide] = useState<Side>('long');
  const [leverage, setLeverage] = useState(2);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<number | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const parsed = parseFloat(amount) || 0;
  const totalIn = parsed * leverage; // input to the swap (after borrowing)
  // The other side: estimate the output of the swap (with 1% slippage).
  useEffect(() => {
    if (!parsed) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const fetchQuote = async () => {
      setQuoteLoading(true);
      try {
        const r =
          side === 'long'
            ? await getBaseOut(poolKey, totalIn)
            : await getQuoteOut(poolKey, totalIn);
        if (!cancelled) setQuote(r);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    };
    fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [side, parsed, totalIn, poolKey, getBaseOut, getQuoteOut]);

  const minOut = quote !== null ? quote * 0.99 : 0;

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction || parsed <= 0 || minOut <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      if (side === 'long') {
        await leveragedLong(
          dAppKit.signAndExecuteTransaction,
          managerId,
          poolKey,
          totalIn,
          minOut,
        );
        notify(`Long ${market.baseAssetSymbol} · ${leverage}× · ${poolKey}`, {
          variant: 'success',
        });
      } else {
        await leveragedShort(
          dAppKit.signAndExecuteTransaction,
          managerId,
          poolKey,
          totalIn,
          minOut,
        );
        notify(`Short ${market.baseAssetSymbol} · ${leverage}× · ${poolKey}`, {
          variant: 'success',
        });
      }
      onClose();
    } catch (e: any) {
      setError(e?.message ?? `${side === 'long' ? 'Long' : 'Short'} failed`);
    } finally {
      setSubmitting(false);
    }
  };

  const stops = useMemo(() => [1, 2, 3, 4, 5], []);
  const valid = parsed > 0 && minOut > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10"
        style={{
          background: 'rgba(26, 29, 46, 0.95)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
              {side === 'long' ? 'Long' : 'Short'} {market.baseAssetSymbol}
            </h3>
            <p className="text-[10px] mt-0.5 font-mono" style={{ color: textMuted }}>
              {market.market}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: textSecondary }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="relative p-5 space-y-4">
          {/* Side toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSide('long')}
              className="py-2 rounded-lg text-xs font-bold transition-all"
              style={{
                background: side === 'long' ? green : 'rgba(255,255,255,0.04)',
                color: side === 'long' ? '#000' : textSecondary,
                border: `1px solid ${side === 'long' ? green : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              Long
            </button>
            <button
              onClick={() => setSide('short')}
              className="py-2 rounded-lg text-xs font-bold transition-all"
              style={{
                background: side === 'short' ? red : 'rgba(255,255,255,0.04)',
                color: side === 'short' ? '#fff' : textSecondary,
                border: `1px solid ${side === 'short' ? red : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              Short
            </button>
          </div>

          {/* Leverage */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                Leverage
              </span>
              <span className="text-sm font-bold" style={{ color: side === 'long' ? green : red }}>
                {leverage}×
              </span>
            </div>
            <div className="flex gap-2">
              {stops.map((s) => (
                <button
                  key={s}
                  onClick={() => setLeverage(s)}
                  className="flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors"
                  style={{
                    background: s === leverage ? (side === 'long' ? green : red) : 'rgba(255,255,255,0.04)',
                    color: s === leverage ? (side === 'long' ? '#000' : '#fff') : textSecondary,
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
              Collateral ({side === 'long' ? market.quoteAssetSymbol : market.baseAssetSymbol})
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 text-sm font-mono text-white outline-none focus:border-white/30"
            />
            <p className="text-[10px] mt-1" style={{ color: textMuted }}>
              Total position: {totalIn.toFixed(2)}{' '}
              {side === 'long' ? market.quoteAssetSymbol : market.baseAssetSymbol} (collateral × leverage)
            </p>
          </div>

          {/* Quote preview */}
          <div
            className="rounded-lg p-3 grid grid-cols-2 gap-3"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                Est. {side === 'long' ? 'Base' : 'Quote'} Out
              </div>
              <div className="text-sm font-mono font-bold mt-0.5" style={{ color: textPrimary }}>
                {quoteLoading && quote === null
                  ? '…'
                  : quote !== null
                    ? quote.toFixed(4)
                    : '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                Min Out (1% slip)
              </div>
              <div className="text-sm font-mono font-bold mt-0.5" style={{ color: green }}>
                {minOut > 0 ? minOut.toFixed(4) : '—'}
              </div>
            </div>
          </div>

          {error && (
            <div
              className="rounded-md p-2.5 text-xs"
              style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5' }}
            >
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || !valid || !account}
            className="w-full py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: valid ? (side === 'long' ? green : red) : 'rgba(255,255,255,0.08)',
              color: valid ? (side === 'long' ? '#000' : '#fff') : textMuted,
            }}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting
              ? 'Signing…'
              : `${side === 'long' ? 'Long' : 'Short'} ${leverage}× · ${parsed || ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
