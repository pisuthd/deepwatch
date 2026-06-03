'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useDeepbook, type CoinBalance } from '../../../hooks/useDeepbook';
import { getCoinIcon } from '../../../lib/coinIcons';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

interface SwapCardProps {
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
 * Uniswap-style swap card. Renders the FROM amount input, the TO computed
 * output, a rate/min-received info row, and a Swap CTA. The base/quote
 * direction is user-toggleable via the arrow button in the middle of the
 * input row — flipping it also swaps input/output values (Uniswap-style).
 *
 * Spot trading is wallet-coin: the user's wallet pays the input amount and
 * receives the output. No BalanceManager, no caps, no extra wallet popups.
 */
type Direction = 'b2q' | 'q2b';

export default function SwapCard({ poolKey, baseAsset, quoteAsset }: SwapCardProps) {
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
  // `b2q` = base → quote (default). `q2b` = quote → base. The arrow button
  // toggles between these and also swaps the input/output values so the user
  // doesn't lose their typed amount when reversing direction.
  const [direction, setDirection] = useState<Direction>('b2q');

  // Derive which asset is currently on the "from" side and which is on the
  // "to" side, plus the matching wallet balance. The pool key is unchanged
  // either way — DeepBook is bidirectional; only the swap function differs.
  const fromAsset = direction === 'b2q' ? baseAsset : quoteAsset;
  const toAsset = direction === 'b2q' ? quoteAsset : baseAsset;
  const fromBalance: number = (() => {
    const found: CoinBalance | undefined = walletBalances.find((b) => b.coinKey === fromAsset);
    return found?.amount ?? 0;
  })();
  // Show the TO asset's wallet balance too — gives the user context for what
  // they'll have left after the swap (and surfaces "you have 0 DBUSDC" before
  // they try to swap quote → base on an empty wallet).
  const toBalance: number = (() => {
    const found: CoinBalance | undefined = walletBalances.find((b) => b.coinKey === toAsset);
    return found?.amount ?? 0;
  })();

  const parsed = parseFloat(fromAmount) || 0;
  const insufficient = parsed > 0 && parsed > fromBalance;

  // ─── Balance refresh ────────────────────────────────────────────────────────
  // Wallet balances are polled so the FROM input reflects external transfers
  // and previous swaps within a few seconds. No manager involved.
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
      // Force an immediate refresh on top of the poll.
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
              style={{ color: green }}
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
              background: 'rgba(0, 230, 138, 0.10)',
              border: '1px solid rgba(0, 230, 138, 0.35)',
              color: green,
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
            <span className="font-mono truncate">
              Bal: {fmtNum(toBalance, 4)} {toAsset}
            </span>
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
              {fmtNum(outNum, 6)}
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

      {/* Info row — rate + min received only. Pool removed. The placeholder
          branches: "Calculating…" while the SDK quote is in flight, a real
          rate once we have an output, "Low liquidity" if the quote came
          back zero (DeepBook testnet pools are sparsely populated, so this
          is the expected state on testnet for many sizes), or the
          neutral "—" / `1 X ≈ — Y` when no amount is typed. */}
      <div
        className="rounded-lg p-2.5 text-[11px] space-y-1.5"
        style={{ background: 'rgba(255, 255, 255, 0.03)' }}
      >
        <div className="flex items-center justify-between" style={{ color: textSecondary }}>
          <span>Rate</span>
          <span className="font-mono" style={{ color: textPrimary }}>
            {quoteLoading
              ? 'Calculating…'
              : parsed > 0 && outNum > 0
                ? rateFor(parsed, outNum, fromAsset, toAsset)
                : parsed > 0
                  ? 'Low liquidity'
                  : `1 ${fromAsset} ≈ — ${toAsset}`}
          </span>
        </div>
        <div className="flex items-center justify-between" style={{ color: textSecondary }}>
          <span>Min received ({slipPct}% slippage)</span>
          <span className="font-mono" style={{ color: parsed > 0 ? green : textPrimary }}>
            {quoteLoading
              ? 'Calculating…'
              : parsed > 0
                ? outNum > 0
                  ? `${fmtNum(minOut, 6)} ${toAsset}`
                  : 'Low liquidity'
                : '—'}
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

      {/* Submit branch ladder — wallet-coin swap, no manager.
          `!account` is the only gate: no BalanceManager to create, no caps
          to mint, no extra popups. */}
      {!account ? (
        <div className="text-center text-xs py-2" style={{ color: textSecondary }}>
          Connect your wallet to swap.
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
