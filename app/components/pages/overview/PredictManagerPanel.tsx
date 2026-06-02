'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usePredict, DUSDC_SCALE } from '../../../hooks/usePredict';

const ConnectButton = dynamic(
  () => import('@mysten/dapp-kit-react/ui').then((mod) => mod.ConnectButton),
  { ssr: false }
);

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const DUSDC_SCALE_NUM = Number(DUSDC_SCALE);

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Tab = 'deposit' | 'withdraw';

export default function PredictManagerPanel() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const {
    manager,
    summary,
    walletDusdcBalance,
    createManager,
    deposit,
    withdraw,
  } = usePredict();

  const [tab, setTab] = useState<Tab>('deposit');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [creatingManager, setCreatingManager] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountValue = summary ? Number(summary.account_value) / DUSDC_SCALE_NUM : 0;
  const tradingBalance = summary ? Number(summary.trading_balance) / DUSDC_SCALE_NUM : 0;
  const unrealizedPnl = summary ? Number(summary.unrealized_pnl) / DUSDC_SCALE_NUM : 0;
  const realizedPnl = summary ? Number(summary.realized_pnl) / DUSDC_SCALE_NUM : 0;
  const redeemableValue = summary ? Number(summary.redeemable_value) / DUSDC_SCALE_NUM : 0;
  const openExposure = summary ? Number(summary.open_exposure) / DUSDC_SCALE_NUM : 0;
  const upnlPct = accountValue > 0 ? (unrealizedPnl / accountValue) * 100 : 0;
  const exposureRatio = accountValue > 0 ? (openExposure / accountValue) * 100 : 0;

  const walletDusdcNum = Number(walletDusdcBalance) / DUSDC_SCALE_NUM;
  const availableForTab = tab === 'deposit' ? walletDusdcNum : tradingBalance;

  const parsedAmount = parseFloat(amount) || 0;
  const insufficient = parsedAmount > availableForTab;

  const handleCreateManager = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction) return;
    setCreatingManager(true);
    setError(null);
    try {
      await createManager(dAppKit.signAndExecuteTransaction);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create manager');
    } finally {
      setCreatingManager(false);
    }
  };

  const handleSubmit = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction || parsedAmount <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      if (tab === 'deposit') {
        await deposit(dAppKit.signAndExecuteTransaction, amount);
      } else {
        await withdraw(dAppKit.signAndExecuteTransaction, amount);
      }
      setAmount('');
    } catch (e: any) {
      setError(e?.message ?? `${tab === 'deposit' ? 'Deposit' : 'Withdraw'} failed`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-6 border border-white/10"
      style={{
        background: 'rgba(26, 29, 46, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: textPrimary }}>Predict Manager</h3>
          {!!manager && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: 'rgba(0,230,138,0.08)', color: green }}>
              Connected
            </span>
          )}
        </div>

        {!account ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <ConnectButton />
            <p className="text-xs" style={{ color: textSecondary }}>
              Connect your wallet to use Predict.
            </p>
          </div>
        ) : !manager ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="text-sm text-center" style={{ color: textSecondary }}>
              You don&apos;t have a Predict account yet. Create one to start trading.
            </p>
            <button
              onClick={handleCreateManager}
              disabled={creatingManager}
              className="w-full max-w-xs py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: green, color: '#000' }}
            >
              {creatingManager && <Loader2 size={14} className="animate-spin" />}
              {creatingManager ? 'Creating…' : 'Create Predict Account'}
            </button>
            {error && (
              <p className="text-xs text-center" style={{ color: red }}>
                {error}
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Headline numbers */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                  Account Value
                </div>
                <div className="text-xl font-mono font-bold mt-0.5" style={{ color: textPrimary }}>
                  {fmtUsd(accountValue)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                  Trading Balance
                </div>
                <div className="text-xl font-mono font-bold mt-0.5" style={{ color: cyan }}>
                  {fmtUsd(tradingBalance)}
                </div>
              </div>
            </div>

            {/* Metrics grid */}
            <div
              className="grid grid-cols-2 gap-y-2.5 gap-x-3 mb-5 rounded-lg p-3"
              style={{ background: 'rgba(255, 255, 255, 0.03)' }}
            >
              <MetricRow label="uPnL" value={`${unrealizedPnl >= 0 ? '+' : ''}${fmtUsd(unrealizedPnl)}`} color={unrealizedPnl >= 0 ? green : red} />
              <MetricRow label="uPnL %" value={`${upnlPct >= 0 ? '+' : ''}${upnlPct.toFixed(2)}%`} color={upnlPct >= 0 ? green : red} />
              <MetricRow label="Realized P&L" value={`${realizedPnl >= 0 ? '+' : ''}${fmtUsd(realizedPnl)}`} color={realizedPnl >= 0 ? green : red} />
              <MetricRow label="Redeemable" value={fmtUsd(redeemableValue)} color={textPrimary} />
              <MetricRow label="Open Exposure" value={fmtUsd(openExposure)} color={textPrimary} />
              <MetricRow label="Exposure Ratio" value={`${exposureRatio.toFixed(1)}%`} color={textPrimary} />
            </div>

            {/* Tabs */}
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {(['deposit', 'withdraw'] as const).map((t) => {
                const isActive = tab === t;
                return (
                  <button
                    key={t}
                    onClick={() => {
                      setTab(t);
                      setAmount('');
                      setError(null);
                    }}
                    className="py-2 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors"
                    style={{
                      background: isActive ? 'rgba(62, 196, 192, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                      border: `1px solid ${isActive ? 'rgba(62, 196, 192, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                      color: isActive ? cyan : textSecondary,
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>

            {/* Available + MAX */}
            <div className="flex items-center justify-between mb-1.5 text-[11px]" style={{ color: textSecondary }}>
              <span>Available</span>
              <span className="font-mono" style={{ color: textPrimary }}>
                {availableForTab.toLocaleString(undefined, { maximumFractionDigits: 6 })} DBUSDC
              </span>
            </div>

            {/* Amount input */}
            <div
              className="flex items-center rounded-lg overflow-hidden mb-3"
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="flex-1 px-3 py-2.5 bg-transparent text-sm font-mono text-white outline-none"
              />
              <button
                onClick={() => setAmount(
                  availableForTab > 0
                    ? availableForTab.toFixed(6).replace(/\.?0+$/, '')
                    : '0'
                )}
                disabled={availableForTab <= 0}
                className="px-3 py-2.5 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: cyan }}
              >
                MAX
              </button>
            </div>

            {error && (
              <div
                className="rounded-md p-2.5 mb-3 text-xs"
                style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
              >
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting || parsedAmount <= 0 || insufficient}
              className="w-full py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              style={{
                background: parsedAmount > 0 && !insufficient ? cyan : 'rgba(255, 255, 255, 0.08)',
                color: parsedAmount > 0 && !insufficient ? '#000' : textSecondary,
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting
                ? (tab === 'deposit' ? 'Depositing…' : 'Withdrawing…')
                : insufficient
                  ? 'Insufficient balance'
                  : tab === 'deposit' ? 'Deposit DBUSDC' : 'Withdraw DBUSDC'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
        {label}
      </span>
      <span className="text-sm font-mono font-semibold mt-0.5" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
