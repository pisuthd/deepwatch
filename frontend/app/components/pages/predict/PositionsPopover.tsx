'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Loader2, X } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usePredict, type Position, type RangePosition } from '../../../hooks/usePredict';
import { useDismissedPositions } from '../../../hooks/useDismissedPositions';
import { useCurrentMarket } from './CurrentMarketContext';
import { useToast } from '../../../context/ToastContext';
import { getCoinIcon } from '../../../lib/coinIcons';
import Countdown from '../../common/Countdown';
import { formatExpiryDate, formatPrice } from './utils';
import RangePositionsTab from './RangePositionsTab';

const green = '#00E68A';
const red = '#ef4444';
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
type Tab = 'binary' | 'range';

const STATUS_LABEL: Record<NonNullable<Position['status']>, string> = {
  active: 'Active',
  redeemable: 'Redeemable',
  lost: 'Lost',
  awaiting_settlement: 'Awaiting',
};

const STATUS_COLOR: Record<NonNullable<Position['status']>, string> = {
  active: green,
  redeemable: green,
  lost: red,
  awaiting_settlement: '#f59e0b',
};

/**
 * A position is "eligible for redeem-all" when the indexer reports a
 * non-active status (`redeemable`, `lost`, `awaiting_settlement`, or
 * `redeemed`) AND the position still has remaining quantity on-chain.
 * Only `active` is excluded (market is still live). Rows with
 * `open_quantity === 0` are excluded because the on-chain Move
 * contract aborts if you try to redeem an already-claimed position —
 * which would poison the whole atomic PTB.
 *
 * Centralised here so the popover and the Overview panel compute
 * the same count.
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
 * active-market path enabled because `predict::redeem` (the
 * non-permissionless variant) is the user's early-exit mechanism.
 * We only grey out when there is genuinely nothing left to claim
 * (`open_quantity === 0`), since submitting a `qty=0` moveCall
 * aborts with `MoveAbort code 3`.
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
 * nothing left to claim on-chain (`open_quantity === 0` on a non-active
 * status). These rows still appear in the indexer's response so the user
 * can see their historical P&L, but the per-row REDEEM button is a
 * no-op against them — the funds are already in the manager balance,
 * available via `predict_manager::withdraw` in the Withdraw tab.
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

export default function PositionsPopover({ onClose }: PositionsPopoverProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { positions, ranges, redeem, redeemRange, redeemAll } = usePredict();
  const { oracleId: currentOracleId, asset: currentAsset } = useCurrentMarket();
  const { notify } = useToast();
  // Track which fully-settled rows the user has hidden. Persisted to
  // localStorage so the cleanup survives refresh.
  const { dismissed, dismiss, restoreAll, count: dismissedCount } = useDismissedPositions();

  const [tab, setTab] = useState<Tab>('binary');
  const [marketFilter, setMarketFilter] = useState<string>(
    currentOracleId ?? 'all'
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // Redeem All state — single button per tab, one PTB, one signature.
  const [submittingAll, setSubmittingAll] = useState<boolean>(false);
  const [allError, setAllError] = useState<string | null>(null);
  // When false, dismissed rows are hidden. Toggle to recover them
  // (e.g. to audit an old win) without losing the dismiss list.
  const [showDismissed, setShowDismissed] = useState<boolean>(false);

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
      // Hide fully-settled rows the user has dismissed, unless
      // `showDismissed` is on (lets them re-audit a win later).
      const rowKey = `${p.oracle_id}|${p.strike}|${p.is_up}`;
      if (!showDismissed && dismissed.has(rowKey)) return false;
      return true;
    });
  }, [sorted, marketFilter, statusFilter, dismissed, showDismissed]);

  // Range positions honour the same market filter but ignore the binary
  // status filter — the indexer has its own range status vocabulary.
  const filteredRanges = useMemo(() => {
    return ranges.filter((r) => {
      if (marketFilter !== 'all' && r.oracle_id !== marketFilter) return false;
      return true;
    });
  }, [ranges, marketFilter]);

  // Eligible counts for the Redeem All button. Scoped to the
  // currently-visible tab AND the active market filter so the user
  // sees exactly how many positions the click will affect.
  const eligibleBinaryCount = useMemo(
    () => filtered.filter(isRedeemAllEligible).length,
    [filtered],
  );
  const eligibleRangeCount = useMemo(
    () => filteredRanges.filter(isRedeemAllEligible).length,
    [filteredRanges],
  );

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
      ? `REDEEM ALL`
      : `REDEEM ALL`;
  const redeemAllCount = tab === 'binary' ? eligibleBinaryCount : eligibleRangeCount;
  const redeemAllDisabled =
    redeemAllCount === 0 || submittingAll || !account || !dAppKit?.signAndExecuteTransaction;

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
            {tab === 'binary' ? filtered.length : filteredRanges.length}
          </span>

          {/* Binary / Range tab toggle */}
          <div
            className="inline-flex items-center rounded-md p-0.5 gap-0.5 ml-2"
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
                  {id === 'binary' ? 'Binary' : 'Range'}
                </button>
              );
            })}
          </div>
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

          {/* Status filter — only meaningful for binary positions */}
          {tab === 'binary' && (
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
          )}

          {/* Dismissed toggle + restore-all — only renders if there are
              any dismissed keys for the active tab (binary only for
              now; range dismissals could be added later). */}
          {tab === 'binary' && dismissedCount > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowDismissed((v) => !v)}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors hover:bg-white/10"
                style={{ color: textSecondary }}
                title={
                  showDismissed
                    ? 'Hide settled rows you previously dismissed'
                    : 'Show settled rows you previously dismissed'
                }
              >
                {showDismissed ? 'hide dismissed' : `+${dismissedCount} dismissed`}
              </button>
              {showDismissed && (
                <button
                  type="button"
                  onClick={restoreAll}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors hover:bg-white/10"
                  style={{ color: textSecondary }}
                  title="Restore every dismissed row (the × button on each row lets you re-dismiss individually)"
                >
                  restore all
                </button>
              )}
            </div>
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
        ) : tab === 'range' ? (
          <RangePositionsTab ranges={filteredRanges} />
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
                <th className="px-3 py-2 font-medium text-right">PnL</th>
                <th className="px-3 py-2 font-medium text-right">Status</th>
                <th className="px-3 py-2 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const key = `${p.oracle_id}|${p.strike}|${p.is_up}`;
                const status = p.status ?? 'active';
                const isDismissed = dismissed.has(key);
                const settled = isFullySettled(p);
                const strikeUsd = Number(p.strike) / PRICE_SCALE_NUM;
                const qty = Number(p.open_quantity) / DUSDC_SCALE_NUM;
                const entry = Number(p.average_entry_price) / PRICE_SCALE_NUM;
                const mark = p.mark_price !== null ? Number(p.mark_price) / PRICE_SCALE_NUM : null;
                const upnl = Number(p.unrealized_pnl ?? 0) / DUSDC_SCALE_NUM;
                const realized = Number(p.realized_pnl ?? 0) / DUSDC_SCALE_NUM;
                // Total P&L = realised (already-closed leg) + unrealised (open leg).
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
                    <td className="px-3 py-2.5 text-right font-mono">
                      {/* Total P&L = realised (closed leg) + unrealised (open leg). */}
                      {/* For active positions this collapses to just uPnL. */}
                      {/* For fully-settled positions this is the final realised amount. */}
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
                          title="You've hidden this row. Click the ↺ button to restore."
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
                              ? 'Position fully settled. The REDEEM button is a no-op — funds are already in your Predict account.'
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
                          {/* Settled rows get a × dismiss action next to the
                              (no-op) REDEEM button — keeps the popover from
                              piling up historical rows. */}
                          {settled && !isDismissed && (
                            <button
                              type="button"
                              onClick={() => dismiss(key)}
                              className="text-[10px] font-mono px-1.5 py-1 rounded transition-colors hover:bg-white/10"
                              style={{ color: textSecondary }}
                              title="Hide this settled row (you can restore it from the +N dismissed chip in the header)"
                            >
                              ×
                            </button>
                          )}
                          {isDismissed && (
                            <button
                              type="button"
                              onClick={() => {/* no per-row restore — use header chip */}}
                              className="text-[10px] font-mono px-1.5 py-1 rounded transition-colors hover:bg-white/10"
                              style={{ color: textSecondary, cursor: 'default' }}
                              title="Use the '+N dismissed' chip in the header to restore"
                            >
                              ↺
                            </button>
                          )}
                          <button
                            onClick={() => handleRedeem(p)}
                            disabled={
                              isSubmitting ||
                              !account ||
                              !dAppKit?.signAndExecuteTransaction
                            }
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                            style={{
                              background: green,
                              color: '#000',
                            }}
                          >
                            {isSubmitting && <Loader2 size={10} className="animate-spin" />}
                            {isSubmitting ? 'Redeeming…' : 'REDEEM'}
                          </button>
                        </div>
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

      {/* Redeem All error — surfaces under the body so the user sees
          it without losing the table context. */}
      {allError && (
        <div
          className="relative z-10 px-4 py-2 border-t border-white/5 text-[10px]"
          style={{ color: red }}
        >
          Redeem all failed: <span title={allError}>{allError}</span>
        </div>
      )}
    </div>
  );
}
