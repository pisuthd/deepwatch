'use client';

/**
 * Range-mode counterpart of the binary positions table inside
 * `PositionsPopover`. Pulls a `RangePosition[]` from `usePredict` and
 * surfaces a per-row Redeem action that delegates to `redeemRange`.
 *
 * The parent popover is responsible for the market/status filter UI and
 * the `Binary | Range` tab toggle — this component only renders the
 * table body + redeem button, given a `ranges` slice (already filtered
 * by the parent if desired).
 */

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usePredict, type RangePosition } from '../../../hooks/usePredict';
import { useToast } from '../../../context/ToastContext';
import { getCoinIcon } from '../../../lib/coinIcons';
import Countdown from '../../common/Countdown';
import { formatPrice } from './utils';

const PRICE_SCALE_NUM = 1e9;
const DUSDC_SCALE_NUM = 1e6;

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

type Status = NonNullable<RangePosition['status']>;

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

function fmtQty(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface RangePositionsTabProps {
  /** The slice to render (parent may have already applied market/status filters). */
  ranges: RangePosition[];
}

export default function RangePositionsTab({ ranges }: RangePositionsTabProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { redeemRange } = usePredict();
  const { notify } = useToast();

  // Local submit/error state is keyed by the range's band tuple so a single
  // row's Redeem can spin independently from the rest of the table.
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const sorted = useMemo(() => {
    return [...ranges].sort((a, b) => {
      const at = a.first_minted_at ?? 0;
      const bt = b.first_minted_at ?? 0;
      return bt - at;
    });
  }, [ranges]);

  const handleRedeem = async (r: RangePosition) => {
    if (!account || !dAppKit?.signAndExecuteTransaction) return;
    const key = `${r.oracle_id}|${r.expiry}|${r.lower_strike}|${r.higher_strike}`;
    setSubmittingKey(key);
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
      const lowerUsd = Number(r.lower_strike) / PRICE_SCALE_NUM;
      const higherUsd = Number(r.higher_strike) / PRICE_SCALE_NUM;
      notify(`Range position redeemed · ${formatPrice(lowerUsd)}–${formatPrice(higherUsd)}`, {
        variant: 'success',
      });
    } catch (e: any) {
      setRowError((er) => ({ ...er, [key]: e?.message ?? 'Redeem failed' }));
    } finally {
      setSubmittingKey(null);
    }
  };

  if (ranges.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs" style={{ color: textSecondary }}>
        No open range positions.
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr
          className="text-left"
          style={{ color: textSecondary, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
        >
          <th className="px-3 py-2 font-medium">Market</th>
          <th className="px-3 py-2 font-medium">Band</th>
          <th className="px-3 py-2 font-medium text-right">Qty</th>
          <th className="px-3 py-2 font-medium text-right">Entry</th>
          <th className="px-3 py-2 font-medium text-right">Mark</th>
          <th className="px-3 py-2 font-medium text-right">uPnL</th>
          <th className="px-3 py-2 font-medium text-right">Status</th>
          <th className="px-3 py-2 font-medium text-right"></th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const key = `${r.oracle_id}|${r.expiry}|${r.lower_strike}|${r.higher_strike}`;
          const status: Status = r.status ?? 'active';
          const lowerUsd = Number(r.lower_strike) / PRICE_SCALE_NUM;
          const higherUsd = Number(r.higher_strike) / PRICE_SCALE_NUM;
          const qty = Number(r.open_quantity) / DUSDC_SCALE_NUM;
          const entry = r.average_entry_price !== undefined
            ? Number(r.average_entry_price) / PRICE_SCALE_NUM
            : null;
          const mark = r.mark_price !== undefined && r.mark_price !== null
            ? Number(r.mark_price) / PRICE_SCALE_NUM
            : null;
          const upnl = r.unrealized_pnl !== undefined ? Number(r.unrealized_pnl) / DUSDC_SCALE_NUM : 0;
          const asset = r.underlying_asset || 'BTC';
          const isSubmitting = submittingKey === key;
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
                    <span className="text-[10px] font-mono" style={{ color: textSecondary }}>
                      <Countdown expiryMs={r.expiry} expiredLabel="ended" />
                    </span>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 font-mono" style={{ color: textPrimary }}>
                {formatPrice(lowerUsd)}–{formatPrice(higherUsd)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: textPrimary }}>
                {fmtQty(qty)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: textSecondary }}>
                {entry !== null ? `$${entry.toFixed(4)}` : '—'}
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
                    onClick={() => handleRedeem(r)}
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
  );
}
