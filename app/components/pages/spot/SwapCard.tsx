'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useDeepbook, type CoinBalance } from '../../../hooks/useDeepbook';
import { getCoinIcon } from '../../../lib/coinIcons';

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
 * Uniswap-style swap card. Renders the FROM amount input, the TO computed
 * output, a rate/min-received info row, and a Swap CTA. The base/quote
 * direction is user-toggleable via the arrow button in the middle of the
 * input row — flipping it also swaps input/output values (Uniswap-style).
 *
 * The branch ladder mirrors `BinaryTradeModal`:
 *  - no account     → ConnectButton
 *  - no manager     → "Create Balance Manager at Overview"
 *  - insufficient   → disabled CTA with hint
 *  - else           → swap
 */
type Direction = 'b2q' | 'q2b';

export default function SwapCard({ poolKey, baseAsset, quoteAsset }: SwapCardProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const {
    managerId,
    sdk,
    balances,
    swapExactBaseForQuote,
    swapExactQuoteForBase,
    refreshBalances,
    error: sdkError,
  } = useDeepbook();

  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('0');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `b2q` = base → quote (default). `q2b` = quote → base. The arrow button
  // toggles between these and also swaps the input/output values so the user
  // doesn't lose their typed amount when reversing direction.
  const [direction, setDirection] = useState<Direction>('b2q');

  // Derive which asset is currently on the "from" side and which is on the
  // "to" side, plus the matching balance. The pool key is unchanged either
  // way — DeepBook is bidirectional; only the swap function differs.
  const fromAsset = direction === 'b2q' ? baseAsset : quoteAsset;
  const toAsset = direction === 'b2q' ? quoteAsset : baseAsset;
  const fromBalance: number = (() => {
    const found: CoinBalance | undefined = balances.find((b) => b.coinKey === fromAsset);
    return found?.amount ?? 0;
  })();

  const parsed = parseFloat(fromAmount) || 0;
  const insufficient = parsed > 0 && parsed > fromBalance;

  // Fetch the output for the current direction. `b2q` quotes quote-out for a
  // base-in amount; `q2b` quotes base-out for a quote-in amount. Debounced so
  // a flurry of keystrokes only triggers one SDK round-trip.
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

  // Flip direction AND swap the typed value into the new "from" side. The
  // `useEffect` above will re-quote the new "to" automatically because
  // `fromAmount` and `direction` both change in the same render.
  const flipDirection = () => {
    setDirection((d) => {
      const newDir: Direction = d === 'b2q' ? 'q2b' : 'b2q';
      // Carry the previous output into the new input so the user's number
      // doesn't get wiped. If the output was 0 (e.g. no quote yet), blank
      // the input instead.
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
      const minOut = Math.max(0, (Number(toAmount) || 0) * 0.995); // 50bps default
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
      await refreshBalances([baseAsset, quoteAsset]);
    } catch (e: any) {
      setError(e?.message ?? 'Swap failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Combined From / To row. Putting both inputs on the same line cuts
          ~50px of vertical space and reads as a single swap operation instead
          of two stacked forms. Layout: From column | arrow | To column. */}
      <div className="flex items-stretch gap-2">
        {/* From column */}
        <div className="flex-1 min-w-0">
          <div
            className="flex items-center justify-between mb-1.5 text-[11px] gap-2"
            style={{ color: textSecondary }}
          >
            <span>From</span>
            <span className="font-mono truncate">
              Bal: {fmtNum(fromBalance, 4)} {fromAsset}
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
              className="flex-1 min-w-0 px-3 py-2.5 bg-transparent text-sm font-mono text-white outline-none"
            />
            <button
              onClick={() => setFromAmount(fromBalance > 0 ? String(fromBalance) : '0')}
              disabled={fromBalance <= 0}
              className="px-2 py-2.5 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              style={{ color: cyan }}
            >
              MAX
            </button>
            <div
              className="px-3 py-2.5 text-xs font-semibold border-l shrink-0 flex items-center gap-1.5"
              style={{ borderColor: 'rgba(255,255,255,0.08)', color: textPrimary }}
            >
              <Image
                src={getCoinIcon(fromAsset)}
                alt={fromAsset}
                width={16}
                height={16}
                className="rounded-full"
              />
              {fromAsset}
            </div>
          </div>
        </div>

        {/* Direction-flip button. Toggles between base→quote and quote→base
            and carries the previous output into the new input so the user
            doesn't lose their number. */}
        <div className="flex items-end pb-1">
          <button
            onClick={flipDirection}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 active:scale-95"
            style={{
              background: 'rgba(62, 196, 192, 0.10)',
              border: '1px solid rgba(62, 196, 192, 0.35)',
              color: cyan,
            }}
            title={`Switch to ${toAsset} → ${fromAsset}`}
            aria-label="Switch swap direction"
          >
            <ArrowLeftRight size={14} />
          </button>
        </div>

        {/* To column */}
        <div className="flex-1 min-w-0">
          <div
            className="flex items-center justify-between mb-1.5 text-[11px] gap-2"
            style={{ color: textSecondary }}
          >
            <span>To (est)</span>
            {quoteLoading && <Loader2 size={10} className="animate-spin shrink-0" />}
          </div>
          <div
            className="flex items-center rounded-lg overflow-hidden"
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div
              className="flex-1 min-w-0 px-3 py-2.5 text-sm font-mono truncate"
              style={{ color: textPrimary }}
            >
              {fmtNum(Number(toAmount), 6)}
            </div>
            <div
              className="px-3 py-2.5 text-xs font-semibold border-l shrink-0 flex items-center gap-1.5"
              style={{ borderColor: 'rgba(255,255,255,0.08)', color: textPrimary }}
            >
              <Image
                src={getCoinIcon(toAsset)}
                alt={toAsset}
                width={16}
                height={16}
                className="rounded-full"
              />
              {toAsset}
            </div>
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
            1 {fromAsset} ≈ {parsed > 0 ? fmtNum(Number(toAmount) / parsed, 6) : '—'} {toAsset}
          </span>
        </div>
        <div className="flex items-center justify-between" style={{ color: textSecondary }}>
          <span>Min received (0.5%)</span>
          <span className="font-mono" style={{ color: textPrimary }}>
            {fmtNum(Number(toAmount) * 0.995, 6)} {toAsset}
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
              : `Swap ${fromAsset} → ${toAsset}`}
        </button>
      )}
    </div>
  );
}
