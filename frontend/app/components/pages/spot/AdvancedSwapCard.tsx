'use client';

import { useEffect, useState } from 'react';
import { ArrowUpDown, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useDeepbook, type CoinBalance } from '../../../hooks/useDeepbook';
import { getCoinIcon } from '../../../lib/coinIcons';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

interface AdvancedSwapCardProps {
  poolKey: string;
  baseAsset: string;
  quoteAsset: string;
}

const SWAP_SLIPPAGE_BPS = 50; // 0.5%
const BALANCE_POLL_MS = 5_000;

function fmtNum(n: number, digits = 6): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function rateFor(parsedFrom: number, toAmount: number, fromAsset: string, toAsset: string) {
  if (parsedFrom <= 0) return `1 ${fromAsset} ≈ — ${toAsset}`;
  const r = toAmount / parsedFrom;
  if (!Number.isFinite(r) || r <= 0) return `1 ${fromAsset} ≈ — ${toAsset}`;
  return `1 ${fromAsset} ≈ ${fmtNum(r, 6)} ${toAsset}`;
}

/**
 * Stacked-layout swap panel for the Advanced mode right column. The standard
 * `SwapCard` lays out FROM | arrow | TO on a single row, which doesn't fit
 * in the ~360px column that Advanced mode gives the swap form. This variant
 * stacks the inputs vertically with a downward flip button between them, and
 * leads with a prominent "Swap BASE/QUOTE" title so the panel reads as a
 * distinct surface rather than a child of the chart card.
 *
 * Trading logic is identical to `SwapCard`: wallet-coin swap, no manager,
 * `deepAmount: 0`. Submits via the same `useDeepbook` swap methods.
 */
type Direction = 'b2q' | 'q2b';

export default function AdvancedSwapCard({ poolKey, baseAsset, quoteAsset }: AdvancedSwapCardProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const {
    sdk,
    walletBalances,
    swapExactBaseForQuote,
    swapExactQuoteForBase,
    refreshWalletBalances,
    error: sdkError,
  } = useDeepbook();

  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('0');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('b2q');

  const fromAsset = direction === 'b2q' ? baseAsset : quoteAsset;
  const toAsset = direction === 'b2q' ? quoteAsset : baseAsset;
  const fromBalance: number = (() => {
    const found: CoinBalance | undefined = walletBalances.find((b) => b.coinKey === fromAsset);
    return found?.amount ?? 0;
  })();
  const toBalance: number = (() => {
    const found: CoinBalance | undefined = walletBalances.find((b) => b.coinKey === toAsset);
    return found?.amount ?? 0;
  })();

  const parsed = parseFloat(fromAmount) || 0;
  const insufficient = parsed > 0 && parsed > fromBalance;

  // Wallet balances are polled so FROM/TO balances reflect external transfers
  // and previous swaps within a few seconds.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      refreshWalletBalances([baseAsset, quoteAsset]);
    };
    refresh();
    const id = setInterval(refresh, BALANCE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account, poolKey, baseAsset, quoteAsset, refreshWalletBalances]);

  // Debounced quote fetch — a flurry of keystrokes only triggers one SDK
  // round-trip.
  useEffect(() => {
    if (!sdk || parsed <= 0) {
      setToAmount('0');
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const handle = setTimeout(async () => {
      try {
        const out = direction === 'b2q'
          ? (await sdk.deepbook.getQuoteQuantityOut(poolKey, parsed))?.quoteOut
          : (await sdk.deepbook.getBaseQuantityOut(poolKey, parsed))?.baseOut;
        if (!cancelled) {
          setToAmount(out ? String(out) : '0');
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
  }, [parsed, poolKey, sdk, direction]);

  const flipDirection = () => {
    setDirection((d) => {
      const newDir: Direction = d === 'b2q' ? 'q2b' : 'b2q';
      const carried = toAmount !== '0' && Number(toAmount) > 0 ? toAmount : '';
      setFromAmount(carried);
      setToAmount('0');
      return newDir;
    });
  };

  const handleSwap = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction || parsed <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const minOut = Math.max(0, (Number(toAmount) || 0) * (1 - SWAP_SLIPPAGE_BPS / 10_000));
      if (direction === 'b2q') {
        await swapExactBaseForQuote(
          dAppKit.signAndExecuteTransaction,
          poolKey,
          parsed,
          minOut,
        );
      } else {
        await swapExactQuoteForBase(
          dAppKit.signAndExecuteTransaction,
          poolKey,
          parsed,
          minOut,
        );
      }
      setFromAmount('');
      setToAmount('0');
      await refreshWalletBalances([baseAsset, quoteAsset]);
    } catch (e: any) {
      setError(e?.message ?? 'Swap failed');
    } finally {
      setSubmitting(false);
    }
  };

  const outNum = Number(toAmount) || 0;
  const minOut = outNum * (1 - SWAP_SLIPPAGE_BPS / 10_000);
  const slipPct = (SWAP_SLIPPAGE_BPS / 100).toFixed(1);

  return (
    <div
      className=" space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold" style={{ color: textPrimary }}>SWAP</h3>
      </div>

      {/* From Input */}
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(255, 255, 255, 0.04)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>From</span>
          <span className="text-[10px] font-mono" style={{ color: textSecondary }}>
            Balance: {fmtNum(fromBalance, 4)} {fromAsset}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={fromAmount}
            onChange={(e) => setFromAmount(e.target.value)}
            placeholder="0.00"
            step="0.01"
            min="0"
            className="flex-1 bg-transparent text-lg font-mono font-semibold text-white outline-none placeholder:text-white/30"
          />
          {/* <button
            onClick={() => setFromAmount(fromBalance > 0 ? String(fromBalance) : '0')}
            disabled={fromBalance <= 0}
            className="px-2 py-1 text-[10px] font-bold rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'rgba(0, 230, 138, 0.15)', color: green }}
          >
            MAX
          </button> */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <Image src={getCoinIcon(fromAsset)} alt={fromAsset} width={14} height={14} className="rounded-full" />
            <span className="text-xs font-semibold" style={{ color: textPrimary }}>{fromAsset}</span>
          </div>
        </div>
      </div>

      {/* Flip Button */}
      <div className="flex justify-center -my-2">
        <button
          onClick={flipDirection}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
          style={{
            background: 'rgba(0, 230, 138, 0.10)',
            border: '2px solid rgba(0, 230, 138, 0.35)',
            color: green,
          }}
          title={`Switch to ${toAsset} → ${fromAsset}`}
          aria-label="Switch swap direction"
        >
          <ArrowUpDown size={16} />
        </button>
      </div>

      {/* To Input */}
      <div
        className="rounded-xl p-3"
        style={{ background: 'rgba(255, 255, 255, 0.04)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>To (est)</span>
          <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: textSecondary }}>
            Balance: {fmtNum(toBalance, 4)} {toAsset}
            {quoteLoading && <Loader2 size={10} className="animate-spin" />}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 text-lg font-mono font-semibold truncate" style={{ color: textPrimary }}>
            {fmtNum(outNum, 6)}
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <Image src={getCoinIcon(toAsset)} alt={toAsset} width={14} height={14} className="rounded-full" />
            <span className="text-xs font-semibold" style={{ color: textPrimary }}>{toAsset}</span>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div
        className="rounded-xl p-3 space-y-2"
        style={{ background: 'rgba(255, 255, 255, 0.03)' }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px]" style={{ color: textSecondary }}>Rate</span>
          <span className="text-[11px] font-mono" style={{ color: textPrimary }}>
            {quoteLoading ? 'Calculating…' : parsed > 0 && outNum > 0 ? rateFor(parsed, outNum, fromAsset, toAsset) : parsed > 0 ? 'Low liquidity' : `1 ${fromAsset} ≈ — ${toAsset}`}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px]" style={{ color: textSecondary }}>Min received ({slipPct}%)</span>
          <span className="text-[11px] font-mono" style={{ color: parsed > 0 ? green : textPrimary }}>
            {quoteLoading ? 'Calculating…' : parsed > 0 ? outNum > 0 ? `${fmtNum(minOut, 6)} ${toAsset}` : 'Low liquidity' : '—'}
          </span>
        </div>
      </div>

      {/* Error */}
      {(error || sdkError) && (
        <div className="rounded-lg p-2.5 text-xs" style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}>
          {error || sdkError}
        </div>
      )}

      {/* Swap Button */}
      {!account ? (
        <div className="text-center text-xs py-3" style={{ color: textSecondary }}>
          Connect your wallet to swap.
        </div>
      ) : (
        <button
          onClick={handleSwap}
          disabled={submitting || parsed <= 0 || insufficient || quoteLoading}
          className="w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
          style={{
            background: parsed > 0 && !insufficient ? green : 'rgba(255, 255, 255, 0.08)',
            color: parsed > 0 && !insufficient ? '#000' : textSecondary,
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Swapping…' : insufficient ? 'Insufficient balance' : `Swap ${fromAsset} → ${toAsset}`}
        </button>
      )}
    </div>
  );
}
