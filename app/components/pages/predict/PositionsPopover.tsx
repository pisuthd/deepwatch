'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Loader2, X } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usePredict, type Position } from '../../../hooks/usePredict';
import { useCurrentMarket } from './CurrentMarketContext';
import { getCoinIcon } from '../../../lib/coinIcons';
import Countdown from '../../common/Countdown';
import { formatExpiryDate, formatPrice } from './utils';

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

interface PositionsPopoverProps {
  onClose: () => void;
}

const PRICE_SCALE_NUM = 1e9;
const DUSDC_SCALE_NUM = 1e6;

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

type StatusFilter = 'all' | 'active' | 'redeemable' | 'lost' | 'awaiting_settlement';

const STATUS_LABEL: Record<NonNullable<Position['status']>, string> = {
  active: 'Active',
  redeemable: 'Redeemable',
  lost: 'Lost',
  awaiting_settlement: 'Awaiting',
};

const STATUS_COLOR: Record<NonNullable<Position['status']>, string> = {
  active: cyan,
  redeemable: green,
  lost: red,
  awaiting_settlement: '#f59e0b',
};

export default function PositionsPopover({ onClose }: PositionsPopoverProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { positions, redeem } = usePredict();
  const { oracleId: currentOracleId, asset: currentAsset } = useCurrentMarket();

  const [marketFilter, setMarketFilter] = useState<string>(
    currentOracleId ?? 'all'
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const sorted = useMemo(() => {
    return [...positions].sort((a, b) => {
      const at = a.first_minted_at ?? 0;
      const bt = b.first_minted_at ?? 0;
      return bt - at;
    });
  }, [positions]);

  const filtered = useMemo(() => {
    return sorted.filter((p) => {
      if (marketFilter !== 'all' && p.oracle_id !== marketFilter) return false;
      if (statusFilter !== 'all' && (p.status ?? 'active') !== statusFilter) return false;
      return true;
    });
  }, [sorted, marketFilter, statusFilter]);

  // Distinct (oracle_id, asset, expiry) tuples present in positions for the dropdown
  const marketOptions = useMemo(() => {
    const map = new Map<string, { oracleId: string; asset: string; expiry: number }>();
    for (const p of positions) {
      if (!map.has(p.oracle_id)) {
        map.set(p.oracle_id, {
          oracleId: p.oracle_id,
          asset: p.underlying_asset || 'BTC',
          expiry: p.expiry,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.expiry - b.expiry);
  }, [positions]);

  const handleRedeem = async (p: Position) => {
    if (!account || !dAppKit?.signAndExecuteTransaction) return;
    const key = `${p.oracle_id}|${p.strike}|${p.is_up}`;
    setSubmittingId(key);
    setRowError((e) => ({ ...e, [key]: '' }));
    try {
      const settled = p.status === 'redeemable' || p.status === 'lost';
      await redeem(
        dAppKit.signAndExecuteTransaction,
        p.oracle_id,
        p.expiry,
        Number(p.strike) / PRICE_SCALE_NUM,
        p.is_up ? 'up' : 'down',
        Number(p.open_quantity) / DUSDC_SCALE_NUM,
        settled,
      );
    } catch (e: any) {
      setRowError((er) => ({ ...er, [key]: e?.message ?? 'Redeem failed' }));
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
            Positions
          </h3>
          <span
            className="text-[10px] font-mono px-1.5 py-px rounded"
            style={{ background: 'rgba(255,255,255,0.06)', color: textSecondary }}
          >
            {filtered.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Market filter */}
          <select
            value={marketFilter}
            onChange={(e) => setMarketFilter(e.target.value)}
            className="text-xs px-2 py-1 rounded-md outline-none border border-white/10"
            style={{ background: 'rgba(40, 44, 60, 0.5)', color: textPrimary }}
          >
            <option value="all">All markets</option>
            {currentOracleId && currentAsset && !marketOptions.find((m) => m.oracleId === currentOracleId) && (
              <option value={currentOracleId}>{currentAsset}/USD · current</option>
            )}
            {marketOptions.map((m) => (
              <option key={m.oracleId} value={m.oracleId}>
                {m.asset}/USD · {formatExpiryDate(m.expiry)}
                {m.oracleId === currentOracleId ? ' · current' : ''}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="text-xs px-2 py-1 rounded-md outline-none border border-white/10"
            style={{ background: 'rgba(40, 44, 60, 0.5)', color: textPrimary }}
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="redeemable">Redeemable</option>
            <option value="lost">Lost</option>
            <option value="awaiting_settlement">Awaiting</option>
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
            Connect your wallet to view positions.
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs" style={{ color: textSecondary }}>
            {positions.length === 0
              ? 'No open positions yet. Place a bet to get started.'
              : 'No positions match the current filter.'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr
                className="text-left"
                style={{ color: textSecondary, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
              >
                <th className="px-3 py-2 font-medium">Market</th>
                <th className="px-3 py-2 font-medium">Side</th>
                <th className="px-3 py-2 font-medium text-right">Strike</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Entry</th>
                <th className="px-3 py-2 font-medium text-right">Mark</th>
                <th className="px-3 py-2 font-medium text-right">uPnL</th>
                <th className="px-3 py-2 font-medium text-right">Status</th>
                <th className="px-3 py-2 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const key = `${p.oracle_id}|${p.strike}|${p.is_up}`;
                const status = p.status ?? 'active';
                const strikeUsd = Number(p.strike) / PRICE_SCALE_NUM;
                const qty = Number(p.open_quantity) / DUSDC_SCALE_NUM;
                const entry = Number(p.average_entry_price) / PRICE_SCALE_NUM;
                const mark = p.mark_price !== null ? Number(p.mark_price) / PRICE_SCALE_NUM : null;
                const upnl = Number(p.unrealized_pnl) / DUSDC_SCALE_NUM;
                const asset = p.underlying_asset || 'BTC';
                const isSubmitting = submittingId === key;
                const err = rowError[key];

                return (
                  <tr
                    key={key}
                    className="border-t border-white/5 hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Image
                          src={getCoinIcon(asset)}
                          alt={asset}
                          width={16}
                          height={16}
                          className="rounded-full shrink-0"
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold" style={{ color: textPrimary }}>
                            {asset}/USD
                          </span>
                          <span className="text-[10px] font-mono" style={{ color: textSecondary }}>
                            <Countdown expiryMs={p.expiry} expiredLabel="ended" />
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="text-sm font-semibold"
                        style={{ color: p.is_up ? green : red }}
                        title={p.is_up ? 'UP' : 'DOWN'}
                      >
                        {p.is_up ? '▲' : '▼'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: textPrimary }}>
                      {formatPrice(strikeUsd)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: textPrimary }}>
                      {fmtQty(qty)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: textSecondary }}>
                      ${entry.toFixed(4)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: textSecondary }}>
                      {mark !== null ? `$${mark.toFixed(4)}` : '—'}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right font-mono"
                      style={{ color: upnl >= 0 ? green : red }}
                    >
                      {upnl >= 0 ? '+' : ''}
                      {fmtUsd(upnl)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{
                          background: `${STATUS_COLOR[status]}1A`,
                          color: STATUS_COLOR[status],
                        }}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={() => handleRedeem(p)}
                          disabled={isSubmitting || !account || !dAppKit?.signAndExecuteTransaction}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          style={{
                            background: 'rgba(62, 196, 192, 0.15)',
                            border: '1px solid rgba(62, 196, 192, 0.4)',
                            color: cyan,
                          }}
                        >
                          {isSubmitting && <Loader2 size={10} className="animate-spin" />}
                          {isSubmitting ? 'Redeeming…' : 'REDEEM'}
                        </button>
                        {err && (
                          <span className="text-[10px] max-w-[160px] truncate" style={{ color: red }} title={err}>
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
