'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useDeepbook, type CoinBalance } from '../../../hooks/useDeepbook';
import { useCurrentPool } from './CurrentPoolContext';
import { getCoinIcon } from '../../../lib/coinIcons';

const ConnectButton = dynamic(
  () => import('@mysten/dapp-kit-react/ui').then((mod) => mod.ConnectButton),
  { ssr: false }
);

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

type Tab = 'deposit' | 'withdraw';

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
 * Assets are scoped to the active market's base/quote (read from
 * `useCurrentPool`). When no market is selected the deposit/withdraw flow
 * is disabled with a "Select market" placeholder.
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

  const { baseAsset, quoteAsset } = useCurrentPool();

  // Assets visible in the popover = base + quote of the active market.
  // Falls back to [] so the "Select market" placeholder can render.
  const availableCoins = useMemo<string[]>(() => {
    const list = [baseAsset, quoteAsset].filter(Boolean) as string[];
    return Array.from(new Set(list));
  }, [baseAsset, quoteAsset]);

  const [tab, setTab] = useState<Tab>('deposit');
  const [coinKey, setCoinKey] = useState<string>('SUI');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [creatingManager, setCreatingManager] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In-input asset selector dropdown
  const [coinMenuOpen, setCoinMenuOpen] = useState(false);
  const coinMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!coinMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (coinMenuRef.current && !coinMenuRef.current.contains(e.target as Node)) {
        setCoinMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [coinMenuOpen]);

  // Snap `coinKey` back into the new list when the active market changes.
  useEffect(() => {
    if (availableCoins.length > 0 && !availableCoins.includes(coinKey)) {
      setCoinKey(availableCoins[0]);
    }
  }, [availableCoins, coinKey]);

  // Refresh balances for the filtered set whenever the active market, account,
  // or manager changes.
  useEffect(() => {
    if (!account || availableCoins.length === 0) return;
    if (managerId) refreshBalances(availableCoins);
    refreshWalletBalances(availableCoins);
  }, [account, managerId, availableCoins, refreshBalances, refreshWalletBalances]);

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
  const flowDisabled = availableCoins.length === 0;

  const handleCreateManager = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction) return;
    setCreatingManager(true);
    setError(null);
    try {
      await createManager(dAppKit.signAndExecuteTransaction);
      if (availableCoins.length > 0) await refreshBalances(availableCoins);
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
      if (availableCoins.length > 0) {
        await refreshBalances(availableCoins);
        await refreshWalletBalances(availableCoins);
      }
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
      {/* Headline — single inline row */}
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[10px] uppercase tracking-wide"
          style={{ color: textSecondary }}
        >
          Manager ID
        </span>
        <span className="text-[10px] font-mono" style={{ color: textPrimary }}>
          {managerId.slice(0, 10)}…{managerId.slice(-6)}
        </span>
      </div>

      {/* Balances grid: one row per asset in the active market */}
      {availableCoins.length > 0 && (
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
          {availableCoins.map((ck) => {
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
                  style={{ color: m > 0 ? green : textSecondary }}
                >
                  {fmtNum(m, 4)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabs (underline-style, green active) */}
      <div
        className="flex mb-3"
        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}
      >
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
              className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors relative"
              style={{
                color: isActive ? green : textSecondary,
                borderBottom: isActive
                  ? `2px solid ${green}`
                  : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* Amount input — asset selector lives INSIDE on the left */}
      <div
        className="flex items-center rounded-lg mb-1.5"
        style={{
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          position: 'relative',
          overflow: 'visible',
        }}
      >
        <div ref={coinMenuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setCoinMenuOpen((v) => !v)}
            disabled={flowDisabled}
            className="flex items-center gap-1.5 pl-2.5 pr-2 py-2.5 hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded-l-lg"
          >
            {availableCoins.length > 0 && (
              <Image
                src={getCoinIcon(coinKey)}
                alt={coinKey}
                width={18}
                height={18}
                className="rounded-full"
              />
            )}
            <span
              className="text-xs font-semibold"
              style={{ color: textPrimary }}
            >
              {availableCoins.length > 0 ? coinKey : 'Select market'}
            </span>
            <ChevronDown
              size={12}
              className={`shrink-0 transition-transform ${
                coinMenuOpen ? 'rotate-180' : ''
              }`}
              style={{ color: textSecondary }}
            />
          </button>

          {/* Divider between trigger and input */}
          <span
            className="absolute top-1.5 bottom-1.5 w-px"
            style={{
              right: 0,
              background: 'rgba(255, 255, 255, 0.08)',
            }}
          />

          {coinMenuOpen && availableCoins.length > 0 && (
            <div
              className="absolute top-full left-0 mt-2 py-1 rounded-xl z-50 overflow-hidden min-w-[160px] shadow-2xl"
              style={{
                background: 'rgba(22, 25, 34, 0.98)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              {availableCoins.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setCoinKey(c);
                    setCoinMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 text-left flex items-center gap-2 transition-colors hover:bg-white/5"
                >
                  <Image
                    src={getCoinIcon(c)}
                    alt={c}
                    width={18}
                    height={18}
                    className="rounded-full"
                  />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: textPrimary }}
                  >
                    {c}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          step="0.01"
          min="0"
          disabled={flowDisabled}
          className="flex-1 px-3 py-2.5 bg-transparent text-sm font-mono text-white outline-none disabled:opacity-50"
        />
        <button
          onClick={() =>
            setAmount(
              availableForTab > 0
                ? availableForTab.toFixed(6).replace(/\.?0+$/, '')
                : '0'
            )
          }
          disabled={availableForTab <= 0 || flowDisabled}
          className="px-3 py-2.5 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: green }}
        >
          MAX
        </button>
      </div>

      {/* Balance line — BELOW the input */}
      <div
        className="flex items-center justify-between mb-3 text-[11px]"
        style={{ color: textSecondary }}
      >
        <span>{tab === 'deposit' ? 'Wallet' : 'Manager'}</span>
        <span className="font-mono" style={{ color: textPrimary }}>
          {fmtNum(availableForTab, 6)} {coinKey}
        </span>
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
        disabled={
          submitting ||
          parsedAmount <= 0 ||
          insufficient ||
          flowDisabled
        }
        className="w-full py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
        style={{
          background:
            parsedAmount > 0 && !insufficient && !flowDisabled
              ? green
              : 'rgba(255, 255, 255, 0.08)',
          color:
            parsedAmount > 0 && !insufficient && !flowDisabled
              ? '#000'
              : textSecondary,
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting && <Loader2 size={14} className="animate-spin" />}
        {submitting
          ? tab === 'deposit'
            ? 'Depositing…'
            : 'Withdrawing…'
          : flowDisabled
            ? 'Select a market'
            : insufficient
              ? 'Insufficient balance'
              : tab === 'deposit'
                ? `Deposit ${coinKey}`
                : `Withdraw ${coinKey}`}
      </button>
    </>
  );
}
