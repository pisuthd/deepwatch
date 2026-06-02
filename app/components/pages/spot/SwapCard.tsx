'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useDeepbook, type CoinBalance } from '../../../hooks/useDeepbook';

const cyan = '#3EC4C0';
const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

interface SwapCardProps {
  poolKey: string;
  baseAsset: string;
  quoteAsset: string;
}

function fmtNum(n: number, digits = 6): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/**
 * Uniswap-style swap card. Renders the FROM (base) amount input, the TO
 * (quote) computed output, a price-impact line, and a Swap CTA. The branch
 * ladder mirrors `BinaryTradeModal`:
 *  - no account     → ConnectButton
 *  - no manager     → "Create Balance Manager at Overview"
 *  - insufficient   → disabled CTA with hint
 *  - else           → swap
 */
export default function SwapCard({ poolKey, baseAsset, quoteAsset }: SwapCardProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { managerId, sdk, balances, swapExactBaseForQuote, refreshBalances, error: sdkError } =
    useDeepbook();

  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('0');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseFloat(fromAmount) || 0;

  const baseBalance: number = (() => {
    const found: CoinBalance | undefined = balances.find((b) => b.coinKey === baseAsset);
    return found?.amount ?? 0;
  })();

  const insufficient = parsed > 0 && parsed > baseBalance;

  // Poll getQuoteQuantityOut on input change (debounced)
  useEffect(() => {
    if (!sdk || parsed <= 0) {
      setToAmount('0');
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const handle = setTimeout(async () => {
      try {
        const r = await sdk.deepbook.getQuoteQuantityOut(poolKey, parsed);
        if (!cancelled) {
          setToAmount(r.quoteOut ? String(r.quoteOut) : '0');
        }
      } catch {
        if (!cancelled) setToAmount('0');
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [parsed, poolKey, sdk]);

  const handleSwap = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction || parsed <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const minOut = Math.max(0, (Number(toAmount) || 0) * 0.995); // 50bps default
      await swapExactBaseForQuote(
        dAppKit.signAndExecuteTransaction,
        poolKey,
        parsed,
        minOut,
      );
      setFromAmount('');
      setToAmount('0');
      await refreshBalances([baseAsset, quoteAsset]);
    } catch (e: any) {
      setError(e?.message ?? 'Swap failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* FROM */}
      <div>
        <div className="flex items-center justify-between mb-1.5 text-[11px]" style={{ color: textSecondary }}>
          <span>From</span>
          <span className="font-mono">
            Balance: {fmtNum(baseBalance, 4)} {baseAsset}
          </span>
        </div>
        <div
          className="flex items-center rounded-lg overflow-hidden"
          style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <input
            type="number"
            value={fromAmount}
            onChange={(e) => setFromAmount(e.target.value)}
            placeholder="0.00"
            step="0.01"
            min="0"
            className="flex-1 px-3 py-2.5 bg-transparent text-sm font-mono text-white outline-none"
          />
          <button
            onClick={() => setFromAmount(baseBalance > 0 ? String(baseBalance) : '0')}
            disabled={baseBalance <= 0}
            className="px-3 py-2.5 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: cyan }}
          >
            MAX
          </button>
          <div
            className="px-3 py-2.5 text-xs font-semibold border-l"
            style={{ borderColor: 'rgba(255,255,255,0.08)', color: textPrimary }}
          >
            {baseAsset}
          </div>
        </div>
      </div>

      {/* Arrow separator */}
      <div className="flex items-center justify-center">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs"
          style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            color: textSecondary,
          }}
        >
          ↓
        </div>
      </div>

      {/* TO */}
      <div>
        <div className="flex items-center justify-between mb-1.5 text-[11px]" style={{ color: textSecondary }}>
          <span>To (estimated)</span>
          {quoteLoading && <Loader2 size={10} className="animate-spin" />}
        </div>
        <div
          className="flex items-center rounded-lg overflow-hidden"
          style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div className="flex-1 px-3 py-2.5 text-sm font-mono" style={{ color: textPrimary }}>
            {fmtNum(Number(toAmount), 6)}
          </div>
          <div
            className="px-3 py-2.5 text-xs font-semibold border-l"
            style={{ borderColor: 'rgba(255,255,255,0.08)', color: textPrimary }}
          >
            {quoteAsset}
          </div>
        </div>
      </div>

      {/* Info row */}
      <div
        className="rounded-lg p-2.5 text-[11px] space-y-1"
        style={{ background: 'rgba(255, 255, 255, 0.03)' }}
      >
        <div className="flex items-center justify-between" style={{ color: textSecondary }}>
          <span>Rate</span>
          <span className="font-mono" style={{ color: textPrimary }}>
            1 {baseAsset} ≈ {parsed > 0 ? fmtNum(Number(toAmount) / parsed, 6) : '—'} {quoteAsset}
          </span>
        </div>
        <div className="flex items-center justify-between" style={{ color: textSecondary }}>
          <span>Min received (0.5%)</span>
          <span className="font-mono" style={{ color: textPrimary }}>
            {fmtNum(Number(toAmount) * 0.995, 6)} {quoteAsset}
          </span>
        </div>
        <div className="flex items-center justify-between" style={{ color: textSecondary }}>
          <span>Pool</span>
          <span className="font-mono" style={{ color: textPrimary }}>
            {poolKey}
          </span>
        </div>
      </div>

      {(error || sdkError) && (
        <div
          className="rounded-md p-2.5 text-xs"
          style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
        >
          {error || sdkError}
        </div>
      )}

      {/* Submit branch ladder */}
      {!account ? (
        <div className="text-center text-xs py-2" style={{ color: textSecondary }}>
          Connect your wallet to swap.
        </div>
      ) : !managerId ? (
        <div
          className="rounded-lg p-2.5 text-xs text-center"
          style={{ background: 'rgba(62, 196, 192, 0.08)', color: cyan }}
        >
          Create a Balance Manager in Overview to start swapping.
        </div>
      ) : (
        <button
          onClick={handleSwap}
          disabled={submitting || parsed <= 0 || insufficient || quoteLoading}
          className="w-full py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
          style={{
            background: parsed > 0 && !insufficient ? green : 'rgba(255, 255, 255, 0.08)',
            color: parsed > 0 && !insufficient ? '#000' : textSecondary,
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting
            ? 'Swapping…'
            : insufficient
              ? 'Insufficient balance'
              : `Swap ${baseAsset} → ${quoteAsset}`}
        </button>
      )}
    </div>
  );
}
