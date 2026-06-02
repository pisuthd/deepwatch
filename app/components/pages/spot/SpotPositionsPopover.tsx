'use client';

import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useDeepbook, type OpenOrder } from '../../../hooks/useDeepbook';
import { useCurrentPool } from './CurrentPoolContext';

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

interface SpotPositionsPopoverProps {
  onClose: () => void;
}

function fmtNum(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export default function SpotPositionsPopover({ onClose }: SpotPositionsPopoverProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { openOrders, cancelOrder } = useDeepbook();
  const { poolKey: currentPoolKey } = useCurrentPool();

  const [poolFilter, setPoolFilter] = useState<string>(currentPoolKey ?? 'all');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const sorted = useMemo(() => {
    return [...openOrders].sort((a, b) => a.poolKey.localeCompare(b.poolKey));
  }, [openOrders]);

  const filtered = useMemo(() => {
    if (poolFilter === 'all') return sorted;
    return sorted.filter((o) => o.poolKey === poolFilter);
  }, [sorted, poolFilter]);

  // Distinct pool keys for the dropdown
  const poolOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of openOrders) set.add(o.poolKey);
    return Array.from(set).sort();
  }, [openOrders]);

  const handleCancel = async (o: OpenOrder) => {
    if (!account || !dAppKit?.signAndExecuteTransaction) return;
    const key = `${o.poolKey}|${o.orderId}`;
    setSubmittingId(key);
    setRowError((e) => ({ ...e, [key]: '' }));
    try {
      await cancelOrder(dAppKit.signAndExecuteTransaction, o.poolKey, o.orderId);
    } catch (e: any) {
      setRowError((er) => ({ ...er, [key]: e?.message ?? 'Cancel failed' }));
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div
      className="absolute bottom-full mb-2 right-0 z-40 w-[760px] max-h-[70vh] overflow-hidden rounded-2xl border border-white/10 flex flex-col"
      style={{
        background: 'rgba(26, 29, 46, 0.95)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
            Open Orders
          </h3>
          <span
            className="text-[10px] font-mono px-1.5 py-px rounded"
            style={{ background: 'rgba(255,255,255,0.06)', color: textSecondary }}
          >
            {filtered.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={poolFilter}
            onChange={(e) => setPoolFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded-md outline-none border border-white/10"
            style={{ background: 'rgba(40, 44, 60, 0.5)', color: textPrimary }}
          >
            <option value="all">All pools</option>
            {currentPoolKey && !poolOptions.includes(currentPoolKey) && (
              <option value={currentPoolKey}>{currentPoolKey} · current</option>
            )}
            {poolOptions.map((p) => (
              <option key={p} value={p}>
                {p}
                {p === currentPoolKey ? ' · current' : ''}
              </option>
            ))}
          </select>

          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: textSecondary }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        {!account ? (
          <div className="px-4 py-8 text-center text-xs" style={{ color: textSecondary }}>
            Connect your wallet to view orders.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs" style={{ color: textSecondary }}>
            {openOrders.length === 0
              ? 'No open orders yet. Place an order to get started.'
              : 'No orders match the current filter.'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr
                className="text-left"
                style={{ color: textSecondary, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                <th className="px-3 py-2 font-medium">Pool</th>
                <th className="px-3 py-2 font-medium">Side</th>
                <th className="px-3 py-2 font-medium text-right">Price</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Filled</th>
                <th className="px-3 py-2 font-medium text-right">Order ID</th>
                <th className="px-3 py-2 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const key = `${o.poolKey}|${o.orderId}`;
                const isSubmitting = submittingId === key;
                const err = rowError[key];
                return (
                  <tr
                    key={key}
                    className="border-t border-white/5 hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-mono font-semibold" style={{ color: textPrimary }}>
                        {o.poolKey}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="text-sm font-semibold"
                        style={{ color: o.isBid ? green : red }}
                        title={o.isBid ? 'BUY' : 'SELL'}
                      >
                        {o.isBid ? '▲ BUY' : '▼ SELL'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: textPrimary }}>
                      {fmtNum(o.price, 4)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: textPrimary }}>
                      {fmtNum(o.quantity, 4)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: textSecondary }}>
                      {fmtNum(o.filledQuantity, 4)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: textSecondary }}>
                      {o.orderId.slice(0, 6)}…{o.orderId.slice(-4)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={() => handleCancel(o)}
                          disabled={isSubmitting || !account || !dAppKit?.signAndExecuteTransaction}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            background: 'rgba(62, 196, 192, 0.15)',
                            border: '1px solid rgba(62, 196, 192, 0.4)',
                            color: cyan,
                          }}
                        >
                          {isSubmitting && <Loader2 size={10} className="animate-spin" />}
                          {isSubmitting ? 'Cancelling…' : 'CANCEL'}
                        </button>
                        {err && (
                          <span
                            className="text-[10px] max-w-[160px] truncate"
                            style={{ color: red }}
                            title={err}
                          >
                            {err}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
