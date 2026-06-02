'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useDeepbook, type CoinBalance } from '../../../hooks/useDeepbook';

const ConnectButton = dynamic(
  () => import('@mysten/dapp-kit-react/ui').then((mod) => mod.ConnectButton),
  { ssr: false }
);

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

type Tab = 'deposit' | 'withdraw';

const COIN_OPTIONS: { key: string; label: string }[] = [
  { key: 'SUI', label: 'SUI' },
  { key: 'USDC', label: 'USDC' },
  { key: 'DBUSDC', label: 'DBUSDC' },
  { key: 'DEEP', label: 'DEEP' },
];

function fmtNum(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

/**
 * Inner content of the Spot BalanceManager (no card chrome, no title bar).
 * Renders one of three branches:
 *  - no account       → ConnectButton
 *  - no manager       → Create Balance Manager
 *  - manager exists   → balances grid + deposit/withdraw tabs
 *
 * Used inside `SpotAccountOverviewPopover` and can be mounted inline on
 * any spot surface.
 */
export default function BalanceManagerContent() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const {
    managerId,
    balances,
    walletBalances,
    refreshBalances,
    refreshWalletBalances,
    createManager,
    deposit,
    withdraw,
    error: sdkError,
  } = useDeepbook();

  const [tab, setTab] = useState<Tab>('deposit');
  const [coinKey, setCoinKey] = useState<string>('SUI');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [creatingManager, setCreatingManager] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const managerBalance: number = (() => {
    const found: CoinBalance | undefined = balances.find((b) => b.coinKey === coinKey);
    return found?.amount ?? 0;
  })();
  const walletBalance: number = (() => {
    const found: CoinBalance | undefined = walletBalances.find((b) => b.coinKey === coinKey);
    return found?.amount ?? 0;
  })();

  // Deposit pulls from the wallet → manager, so available is the wallet
  // balance. Withdraw is the reverse, so available is the manager balance.
  const availableForTab = tab === 'deposit' ? walletBalance : managerBalance;

  const parsedAmount = parseFloat(amount) || 0;
  const insufficient = parsedAmount > availableForTab;

  const handleCreateManager = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction) return;
    setCreatingManager(true);
    setError(null);
    try {
      await createManager(dAppKit.signAndExecuteTransaction);
      await refreshBalances(['SUI', 'USDC', 'DBUSDC', 'DEEP']);
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
        await deposit(dAppKit.signAndExecuteTransaction, coinKey, parsedAmount);
      } else {
        await withdraw(dAppKit.signAndExecuteTransaction, coinKey, parsedAmount);
      }
      setAmount('');
      await refreshBalances(['SUI', 'USDC', 'DBUSDC', 'DEEP']);
      await refreshWalletBalances(['SUI', 'USDC', 'DBUSDC', 'DEEP']);
    } catch (e: any) {
      setError(e?.message ?? `${tab === 'deposit' ? 'Deposit' : 'Withdraw'} failed`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!account) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <ConnectButton />
        <p className="text-xs" style={{ color: textSecondary }}>
          Connect your wallet to use Spot.
        </p>
      </div>
    );
  }

  if (!managerId) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <p className="text-sm text-center" style={{ color: textSecondary }}>
          You don&apos;t have a DeepBook Balance Manager yet. Create one to start trading.
        </p>
        <button
          onClick={handleCreateManager}
          disabled={creatingManager}
          className="w-full max-w-xs py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: green, color: '#000' }}
        >
          {creatingManager && <Loader2 size={14} className="animate-spin" />}
          {creatingManager ? 'Creating…' : 'Create Balance Manager'}
        </button>
        {(error || sdkError) && (
          <p className="text-xs text-center" style={{ color: red }}>
            {error || sdkError}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Headline */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
          Manager ID
        </div>
        <div className="text-[10px] font-mono mt-0.5" style={{ color: textPrimary }}>
          {managerId.slice(0, 10)}…{managerId.slice(-6)}
        </div>
      </div>

      {/* Balances grid: one row per asset, wallet + manager columns */}
      <div
        className="rounded-lg p-3 mb-5"
        style={{ background: 'rgba(255, 255, 255, 0.03)' }}
      >
        <div
          className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 text-[10px] uppercase tracking-wide mb-1.5"
          style={{ color: textSecondary }}
        >
          <span>Asset</span>
          <span className="text-right">Wallet</span>
          <span className="text-right">Manager</span>
        </div>
        {(['SUI', 'USDC', 'DBUSDC', 'DEEP'] as const).map((ck) => {
          const w = walletBalances.find((b) => b.coinKey === ck)?.amount ?? 0;
          const m = balances.find((b) => b.coinKey === ck)?.amount ?? 0;
          return (
            <div
              key={ck}
              className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline py-0.5"
            >
              <span className="text-[11px] font-semibold" style={{ color: textPrimary }}>
                {ck}
              </span>
              <span
                className="text-[11px] font-mono text-right"
                style={{ color: w > 0 ? textPrimary : textSecondary }}
              >
                {fmtNum(w, 4)}
              </span>
              <span
                className="text-[11px] font-mono text-right"
                style={{ color: m > 0 ? cyan : textSecondary }}
              >
                {fmtNum(m, 4)}
              </span>
            </div>
          );
        })}
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

      {/* Coin selector */}
      <div className="mb-3">
        <div className="text-[11px] mb-1.5" style={{ color: textSecondary }}>
          Asset
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {COIN_OPTIONS.map((c) => {
            const isActive = coinKey === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setCoinKey(c.key)}
                className="py-1.5 rounded-md text-[11px] font-semibold transition-colors"
                style={{
                  background: isActive ? 'rgba(62, 196, 192, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${isActive ? 'rgba(62, 196, 192, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                  color: isActive ? cyan : textSecondary,
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Available + MAX */}
      <div className="flex items-center justify-between mb-1.5 text-[11px]" style={{ color: textSecondary }}>
        <span>
          {tab === 'deposit' ? 'Wallet' : 'Manager'} balance
        </span>
        <span className="font-mono" style={{ color: textPrimary }}>
          {fmtNum(availableForTab, 6)} {coinKey}
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
          onClick={() =>
            setAmount(
              availableForTab > 0
                ? availableForTab.toFixed(6).replace(/\.?0+$/, '')
                : '0'
            )
          }
          disabled={availableForTab <= 0}
          className="px-3 py-2.5 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: cyan }}
        >
          MAX
        </button>
      </div>

      {(error || sdkError) && (
        <div
          className="rounded-md p-2.5 mb-3 text-xs"
          style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
        >
          {error || sdkError}
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
            : tab === 'deposit'
              ? `Deposit ${coinKey}`
              : `Withdraw ${coinKey}`}
      </button>
    </>
  );
}
