'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useDeepbook, type CoinBalance } from '../../../hooks/useDeepbook';

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

type OrderType = 'limit' | 'market';
type Side = 'buy' | 'sell';

interface TradePanelProps {
  poolKey: string;
  baseAsset: string;
  quoteAsset: string;
  initialPrice?: number;
}

function fmtNum(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export default function TradePanel({ poolKey, baseAsset, quoteAsset, initialPrice }: TradePanelProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { managerId, balances, placeLimitOrder, placeMarketOrder, refreshBalances, error: sdkError } =
    useDeepbook();

  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [side, setSide] = useState<Side>('buy');
  const [price, setPrice] = useState(initialPrice ? String(initialPrice) : '');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBid = side === 'buy';

  const baseBalance: number = (() => {
    const found: CoinBalance | undefined = balances.find((b) => b.coinKey === baseAsset);
    return found?.amount ?? 0;
  })();
  const quoteBalance: number = (() => {
    const found: CoinBalance | undefined = balances.find((b) => b.coinKey === quoteAsset);
    return found?.amount ?? 0;
  })();

  const parsedPrice = parseFloat(price) || 0;
  const parsedAmount = parseFloat(amount) || 0;
  const total = parsedPrice * parsedAmount;
  const insufficient = isBid ? total > quoteBalance : parsedAmount > baseBalance;

  const handleSubmit = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction || parsedAmount <= 0) return;
    if (orderType === 'limit' && parsedPrice <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      if (orderType === 'limit') {
        await placeLimitOrder(
          dAppKit.signAndExecuteTransaction,
          poolKey,
          parsedPrice,
          parsedAmount,
          isBid,
        );
      } else {
        await placeMarketOrder(
          dAppKit.signAndExecuteTransaction,
          poolKey,
          parsedAmount,
          isBid,
        );
      }
      setAmount('');
      await refreshBalances([baseAsset, quoteAsset]);
    } catch (e: any) {
      setError(e?.message ?? 'Order failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Underline tab bar — Limit/Market order-type, then Buy/Sell side.
          `border-b` on the parent plus a 2px transparent border on inactive
          tabs (and 2px cyan/green/red on active) keeps the layout stable
          when the active tab changes (no height jump). */}
      <div
        className="flex"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}
      >
        {(['limit', 'market'] as const).map((t) => {
          const isActive = orderType === t;
          return (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors relative"
              style={{
                color: isActive ? cyan : textSecondary,
                borderBottom: isActive
                  ? `2px solid ${cyan}`
                  : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {t}
            </button>
          );
        })}
        <div className="flex-1" />
        {(['buy', 'sell'] as const).map((s) => {
          const isActive = side === s;
          const color = s === 'buy' ? green : red;
          return (
            <button
              key={s}
              onClick={() => setSide(s)}
              className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors relative"
              style={{
                color: isActive ? color : textSecondary,
                borderBottom: isActive
                  ? `2px solid ${color}`
                  : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {s} {baseAsset}
            </button>
          );
        })}
      </div>

      {/* Price (limit only) */}
      {orderType === 'limit' && (
        <div>
          <div className="flex items-center justify-between mb-1.5 text-[11px]" style={{ color: textSecondary }}>
            <span>Price ({quoteAsset})</span>
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
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              step="0.0001"
              min="0"
              className="flex-1 px-3 py-2 bg-transparent text-sm font-mono text-white outline-none"
            />
          </div>
        </div>
      )}

      {/* Amount */}
      <div>
        <div className="flex items-center justify-between mb-1.5 text-[11px]" style={{ color: textSecondary }}>
          <span>Amount ({baseAsset})</span>
          <span className="font-mono">
            {fmtNum(isBid ? quoteBalance : baseBalance, 4)} {isBid ? quoteAsset : baseAsset}
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
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0000"
            step="0.0001"
            min="0"
            className="flex-1 px-3 py-2 bg-transparent text-sm font-mono text-white outline-none"
          />
          <button
            onClick={() => {
              if (isBid) {
                // Max base we can buy with our quote balance
                const maxBase = parsedPrice > 0 ? quoteBalance / parsedPrice : 0;
                setAmount(maxBase > 0 ? String(maxBase) : '0');
              } else {
                setAmount(baseBalance > 0 ? String(baseBalance) : '0');
              }
            }}
            disabled={(isBid ? quoteBalance : baseBalance) <= 0}
            className="px-3 py-2 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: cyan }}
          >
            MAX
          </button>
        </div>
      </div>

      {/* Total */}
      <div className="flex items-center justify-between text-[11px]" style={{ color: textSecondary }}>
        <span>Total</span>
        <span className="font-mono" style={{ color: textPrimary }}>
          {orderType === 'limit' ? fmtNum(total, 4) : '—'} {quoteAsset}
        </span>
      </div>

      {(error || sdkError) && (
        <div
          className="rounded-md p-2.5 text-xs"
          style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
        >
          {error || sdkError}
        </div>
      )}

      {/* Branch ladder */}
      {!account ? (
        <div className="text-center text-xs py-2" style={{ color: textSecondary }}>
          Connect your wallet to trade.
        </div>
      ) : !managerId ? (
        <div
          className="rounded-lg p-2.5 text-xs text-center"
          style={{ background: 'rgba(62, 196, 192, 0.08)', color: cyan }}
        >
          Create a Balance Manager in Overview to start trading.
        </div>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={
            submitting ||
            parsedAmount <= 0 ||
            (orderType === 'limit' && parsedPrice <= 0) ||
            insufficient
          }
          className="w-full py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
          style={{
            background:
              parsedAmount > 0 && !insufficient ? (isBid ? green : red) : 'rgba(255, 255, 255, 0.08)',
            color: parsedAmount > 0 && !insufficient ? (isBid ? '#000' : '#fff') : textSecondary,
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting
            ? 'Submitting…'
            : insufficient
              ? 'Insufficient balance'
              : `${isBid ? 'Buy' : 'Sell'} ${baseAsset}`}
        </button>
      )}
    </div>
  );
}
