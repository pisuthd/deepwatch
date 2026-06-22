'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Loader2, X } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usePredict, type Position, type RangePosition } from '../../../hooks/usePredict';
import { useDismissedPositions } from '../../../hooks/useDismissedPositions';
import { getCoinIcon } from '../../../lib/coinIcons';
import Countdown from '../../common/Countdown';
import { useToast } from '../../../context/ToastContext';
import { formatExpiryDate, formatPrice } from '../predict/utils';

const PRICE_SCALE_NUM = 1e9;
const DUSDC_SCALE_NUM = 1e6;

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

type Status = NonNullable<Position['status']>;

const STATUS_LABEL: Record<Status, string> = {
  active: 'Active',
  redeemable: 'Redeemable',
  lost: 'Lost',
  awaiting_settlement: 'Awaiting',
};

const STATUS_COLOR: Record<Status, string> = {
  active: cyan,
  redeemable: green,
  lost: red,
  awaiting_settlement: '#f59e0b',
};

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtQty(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

type Tab = 'binary' | 'range';

interface MarketOption {
  oracleId: string;
  asset: string;
  expiry: number;
}

/**
 * A position is "eligible for redeem-all" when the indexer reports a
 * non-active status (`redeemable`, `lost`, `awaiting_settlement`, or
 * `redeemed`) AND the position still has remaining quantity on-chain.
 * Only `active` is excluded (market is still live). Rows with
 * `open_quantity === 0` are excluded because the on-chain Move
 * contract aborts if you try to redeem an already-claimed position —
 * which would poison the whole atomic PTB.
 *
 * Mirrors the same predicate in `PositionsPopover` so both panels
 * surface the same eligible count.
 */
function isRedeemAllEligible(
  p: {
    status?: Position['status'] | RangePosition['status'];
    open_quantity?: string;
  },
): boolean {
  if (p.status === undefined || p.status === 'active') return false;
  if (!p.open_quantity) return false;
  try {
    return BigInt(p.open_quantity) > BigInt(0);
  } catch {
    return false;
  }
}

/**
 * Per-row predicate: can the user redeem anything on this position?
 * Looser than `isRedeemAllEligible` — we deliberately keep the
 * active-market path enabled because `predict::redeem` /
 * `predict::redeem_range` (the non-permissionless variants) are the
 * user's early-exit mechanisms. We only grey out when there is
 * genuinely nothing left to claim (`open_quantity === 0`), since
 * submitting a `qty=0` moveCall aborts with `MoveAbort code 3`.
 */
function hasRedeemableQty(p: { open_quantity?: string }): boolean {
  if (!p.open_quantity) return false;
  try {
    return BigInt(p.open_quantity) > BigInt(0);
  } catch {
    return false;
  }
}

/**
 * A position is "fully settled" when the oracle has run and there is
 * nothing left to claim on-chain. Mirrors PositionsPopover's predicate
 * so the two panels agree on which rows are historical vs. actionable.
 */
function isFullySettled(p: {
  status?: Position['status'];
  open_quantity?: string;
}): boolean {
  if (!p.status || p.status === 'active' || p.status === 'awaiting_settlement') {
    return false;
  }
  if (!p.open_quantity) return true;
  try {
    return BigInt(p.open_quantity) === BigInt(0);
  } catch {
    return false;
  }
}

/**
 * Overview-page positions panel. Renders a glass card with a Binary | Range
 * tab toggle and the corresponding table, fed by `usePredict`. Compact
 * counterpart of `PositionsPopover` — designed to sit on the Overview page
 * next to `PredictManagerPanel` so the user can see and redeem open
 * positions without leaving the page.
 */
export default function PositionsPanel() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { positions, ranges, redeem, redeemRange, redeemAll } = usePredict();
  const { notify } = useToast();
  // Shared dismiss state with PositionsPopover — both panels consult
  // the same localStorage-backed set so dismissing in one hides it in
  // the other.
  const { dismissed, dismiss } = useDismissedPositions();

  const [tab, setTab] = useState<Tab>('binary');
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // Redeem All state — one PTB covering the eligible slice of the active tab.
  const [submittingAll, setSubmittingAll] = useState<boolean>(false);
  const [allError, setAllError] = useState<string | null>(null);

  const sortedBinary = useMemo(() => {
    return [...positions].sort((a, b) => (b.first_minted_at ?? 0) - (a.first_minted_at ?? 0));
  }, [positions]);

  const sortedRanges = useMemo(() => {
    return [...ranges].sort((a, b) => (b.first_minted_at ?? 0) - (a.first_minted_at ?? 0));
  }, [ranges]);

  const filteredBinary = useMemo(() => {
    return sortedBinary.filter((p) => marketFilter === 'all' || p.oracle_id === marketFilter);
  }, [sortedBinary, marketFilter]);

  const filteredRanges = useMemo(() => {
    return sortedRanges.filter((r) => marketFilter === 'all' || r.oracle_id === marketFilter);
  }, [sortedRanges, marketFilter]);

  const marketOptions: MarketOption[] = useMemo(() => {
    const map = new Map<string, MarketOption>();
    for (const p of positions) {
      if (!map.has(p.oracle_id)) {
        map.set(p.oracle_id, {
          oracleId: p.oracle_id,
          asset: p.underlying_asset || 'BTC',
          expiry: p.expiry,
        });
      }
    }
    for (const r of ranges) {
      if (!map.has(r.oracle_id)) {
        map.set(r.oracle_id, {
          oracleId: r.oracle_id,
          asset: r.underlying_asset || 'BTC',
          expiry: r.expiry,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.expiry - b.expiry);
  }, [positions, ranges]);

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

  const handleRedeemRange = async (r: RangePosition) => {
    if (!account || !dAppKit?.signAndExecuteTransaction) return;
    const key = `${r.oracle_id}|${r.expiry}|${r.lower_strike}|${r.higher_strike}`;
    setSubmittingId(key);
    setRowError((e) => ({ ...e, [key]: '' }));
    try {
      const settled = r.status === 'redeemable' || r.status === 'lost';
      await redeemRange(
        dAppKit.signAndExecuteTransaction,
        r.oracle_id,
        r.expiry,
        Number(r.lower_strike) / PRICE_SCALE_NUM,
        Number(r.higher_strike) / PRICE_SCALE_NUM,
        Number(r.open_quantity) / DUSDC_SCALE_NUM,
        settled,
      );
    } catch (e: any) {
      setRowError((er) => ({ ...er, [key]: e?.message ?? 'Redeem failed' }));
    } finally {
      setSubmittingId(null);
    }
  };

  const total = positions.length + ranges.length;
  const currentCount = tab === 'binary' ? filteredBinary.length : filteredRanges.length;

  // Eligible counts for the Redeem All button. Scoped to the active tab AND
  // the active market filter so the user sees exactly how many positions
  // the click will affect.
  const eligibleBinaryCount = useMemo(
    () => filteredBinary.filter(isRedeemAllEligible).length,
    [filteredBinary],
  );
  const eligibleRangeCount = useMemo(
    () => filteredRanges.filter(isRedeemAllEligible).length,
    [filteredRanges],
  );

  const handleRedeemAll = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction) return;
    const kind = tab;
    const count = kind === 'binary' ? eligibleBinaryCount : eligibleRangeCount;
    if (count === 0) return;
    setSubmittingAll(true);
    setAllError(null);
    try {
      const { redeemedCount } = await redeemAll(dAppKit.signAndExecuteTransaction, kind);
      notify(
        `Redeemed ${redeemedCount} ${kind === 'binary' ? 'binary' : 'range'} position${redeemedCount === 1 ? '' : 's'}`,
        { variant: 'success' },
      );
    } catch (e: any) {
      const msg = e?.message ?? 'Redeem all failed';
      setAllError(msg);
      notify(msg, { variant: 'error' });
    } finally {
      setSubmittingAll(false);
    }
  };

  const redeemAllLabel =
    tab === 'binary'
      ? `REDEEM ALL BINARY${eligibleBinaryCount > 0 ? ` (${eligibleBinaryCount})` : ''}`
      : `REDEEM ALL RANGE${eligibleRangeCount > 0 ? ` (${eligibleRangeCount})` : ''}`;
  const redeemAllCount = tab === 'binary' ? eligibleBinaryCount : eligibleRangeCount;
  const redeemAllDisabled =
    redeemAllCount === 0 || submittingAll || !account || !dAppKit?.signAndExecuteTransaction;

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-6 border border-white/10 flex flex-col"
      style={{
        background: 'rgba(26, 29, 46, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      <div className="relative z-10 flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-bold" style={{ color: textPrimary }}>
            Positions
          </h3>
          <span
            className="text-[10px] font-mono px-1.5 py-px rounded"
            style={{ background: 'rgba(255,255,255,0.06)', color: textSecondary }}
          >
            {total}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Binary / Range tab toggle */}
          <div
            className="inline-flex items-center rounded-md p-0.5 gap-0.5"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {(['binary', 'range'] as const).map((id) => {
              const isActive = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className="px-2.5 py-0.5 rounded text-[11px] font-semibold transition-colors"
                  style={{
                    background: isActive ? green : 'transparent',
                    color: isActive ? '#000' : textSecondary,
                  }}
                >
                  {id === 'binary' ? `Binary · ${filteredBinary.length}` : `Range · ${filteredRanges.length}`}
                </button>
              );
            })}
          </div>

          {/* Market filter */}
          {marketOptions.length > 0 && (
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="text-xs px-2 py-1 rounded-md outline-none border border-white/10"
              style={{ background: 'rgba(40, 44, 60, 0.5)', color: textPrimary }}
            >
              <option value="all">All markets</option>
              {marketOptions.map((m) => (
                <option key={m.oracleId} value={m.oracleId}>
                  {m.asset}/USD · {formatExpiryDate(m.expiry)}
                </option>
              ))}
            </select>
          )}

          {/* Redeem All — one button, scoped to the active tab and the
              active market filter. Disabled when count is 0. */}
          <button
            type="button"
            onClick={handleRedeemAll}
            disabled={redeemAllDisabled}
            title={
              redeemAllCount === 0
                ? 'No settled positions to redeem'
                : `Redeem all ${tab === 'binary' ? 'binary' : 'range'} settled positions in a single PTB`
            }
            className="text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
            style={{
              background: green,
              color: '#000',
            }}
          >
            {submittingAll && <Loader2 size={10} className="animate-spin" />}
            {submittingAll ? 'REDEEMING…' : redeemAllLabel}
          </button>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-x-auto">
        {!account ? (
          <div className="py-8 text-center text-xs" style={{ color: textSecondary }}>
            Connect your wallet to view positions.
          </div>
        ) : tab === 'binary' ? (
          filteredBinary.length === 0 ? (
            <div className="py-8 text-center text-xs" style={{ color: textSecondary }}>
              {positions.length === 0
                ? 'No open positions yet. Place a bet to get started.'
                : 'No positions match the current filter.'}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr
                  className="text-left"
                  style={{
                    color: textSecondary,
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  <th className="px-3 py-2 font-medium">Market</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium text-right">Strike</th>
                  <th className="px-3 py-2 font-medium text-right">Qty</th>
                  <th className="px-3 py-2 font-medium text-right">PnL</th>
                  <th className="px-3 py-2 font-medium text-right">Status</th>
                  <th className="px-3 py-2 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody>
                {filteredBinary.map((p) => {
                  const key = `${p.oracle_id}|${p.strike}|${p.is_up}`;
                  const status: Status = p.status ?? 'active';
                  const isDismissed = dismissed.has(key);
                  const settled = isFullySettled(p);
                  const strikeUsd = Number(p.strike) / PRICE_SCALE_NUM;
                  const qty = Number(p.open_quantity) / DUSDC_SCALE_NUM;
                  const upnl = Number(p.unrealized_pnl ?? 0) / DUSDC_SCALE_NUM;
                  const realized = Number(p.realized_pnl ?? 0) / DUSDC_SCALE_NUM;
                  const totalPnl = realized + upnl;
                  const asset = p.underlying_asset || 'BTC';
                  const isSubmitting = submittingId === key;
                  const err = rowError[key];

                  return (
                    <tr
                      key={key}
                      style={isDismissed ? { opacity: 0.55 } : undefined}
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
                            <span
                              className="text-[10px] font-mono"
                              style={{ color: textSecondary }}
                            >
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
                      <td
                        className="px-3 py-2.5 text-right font-mono"
                        style={{ color: textPrimary }}
                      >
                        {formatPrice(strikeUsd)}
                      </td>
                      <td
                        className="px-3 py-2.5 text-right font-mono"
                        style={{ color: textPrimary }}
                      >
                        {fmtQty(qty)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {/* Total P&L = realised (closed leg) + unrealised (open leg). */}
                        <div
                          className="font-semibold leading-tight"
                          style={{ color: totalPnl >= 0 ? green : red }}
                          title={`Realised ${realized >= 0 ? '+' : ''}${fmtUsd(realized)} · Unrealised ${upnl >= 0 ? '+' : ''}${fmtUsd(upnl)}`}
                        >
                          {totalPnl >= 0 ? '+' : ''}{fmtUsd(totalPnl)}
                        </div>
                        {Math.abs(realized) >= 0.005 && (
                          <div
                            className="text-[9px] font-mono leading-tight mt-0.5"
                            style={{ color: realized >= 0 ? green : red, opacity: 0.75 }}
                            title="Closed-leg P&L (already locked in by prior redemptions)"
                          >
                            closed {realized >= 0 ? '+' : ''}{fmtUsd(realized)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {isDismissed ? (
                          <span
                            className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                            style={{
                              background: 'rgba(255,255,255,0.06)',
                              color: textSecondary,
                            }}
                            title="You've hidden this row from the popover. Use the +N dismissed chip to restore."
                          >
                            Claimed · hidden
                          </span>
                        ) : (
                          <span
                            className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                            style={{
                              background: `${STATUS_COLOR[status]}1A`,
                              color: STATUS_COLOR[status],
                            }}
                            title={
                              settled
                                ? 'Position fully settled — REDEEM is a no-op (funds are already in your Predict account).'
                                : undefined
                            }
                          >
                            {settled
                              ? `${STATUS_LABEL[status]} · settled`
                              : STATUS_LABEL[status]}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1">
                            {settled && !isDismissed && (
                              <button
                                type="button"
                                onClick={() => dismiss(key)}
                                className="text-[10px] font-mono px-1.5 py-1 rounded transition-colors hover:bg-white/10"
                                style={{ color: textSecondary }}
                                title="Hide this settled row"
                              >
                                ×
                              </button>
                            )}
                            <button
                              onClick={() => handleRedeem(p)}
                              disabled={
                                isSubmitting ||
                                !account ||
                                !dAppKit?.signAndExecuteTransaction
                              }
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
                          </div>
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
          )
        ) : filteredRanges.length === 0 ? (
          <div className="py-8 text-center text-xs" style={{ color: textSecondary }}>
            {ranges.length === 0
              ? 'No open range positions yet.'
              : 'No range positions match the current filter.'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr
                className="text-left"
                style={{
                  color: textSecondary,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                <th className="px-3 py-2 font-medium">Market</th>
                <th className="px-3 py-2 font-medium">Band</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">uPnL</th>
                <th className="px-3 py-2 font-medium text-right">Status</th>
                <th className="px-3 py-2 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRanges.map((r) => {
                const key = `${r.oracle_id}|${r.expiry}|${r.lower_strike}|${r.higher_strike}`;
                const status: Status = r.status ?? 'active';
                const lowerUsd = Number(r.lower_strike) / PRICE_SCALE_NUM;
                const higherUsd = Number(r.higher_strike) / PRICE_SCALE_NUM;
                const qty = Number(r.open_quantity) / DUSDC_SCALE_NUM;
                const upnl =
                  r.unrealized_pnl !== undefined ? Number(r.unrealized_pnl) / DUSDC_SCALE_NUM : 0;
                const asset = r.underlying_asset || 'BTC';
                const isSubmitting = submittingId === key;
                const err = rowError[key];

                return (
                  <tr key={key} className="border-t border-white/5 hover:bg-white/[0.02]">
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
                          <span
                            className="text-[10px] font-mono"
                            style={{ color: textSecondary }}
                          >
                            <Countdown expiryMs={r.expiry} expiredLabel="ended" />
                          </span>
                        </div>
                      </div>
                    </td>
                    <td
                      className="px-3 py-2.5 font-mono"
                      style={{ color: textPrimary }}
                    >
                      {formatPrice(lowerUsd)}–{formatPrice(higherUsd)}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right font-mono"
                      style={{ color: textPrimary }}
                    >
                      {fmtQty(qty)}
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
                          onClick={() => handleRedeemRange(r)}
                          disabled={
                            isSubmitting ||
                            !account ||
                            !dAppKit?.signAndExecuteTransaction
                          }
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

      {currentCount === 0 && account && (
        <div className="relative z-10 mt-3 pt-3 border-t border-white/5 text-[10px]" style={{ color: textSecondary }}>
          No {tab} positions match the current view.
        </div>
      )}

      {/* Redeem All error — surfaces under the body so the user sees
          it without losing the table context. */}
      {allError && (
        <div
          className="relative z-10 mt-2 text-[10px]"
          style={{ color: red }}
        >
          Redeem all failed: <span title={allError}>{allError}</span>
        </div>
      )}
    </div>
  );
}
