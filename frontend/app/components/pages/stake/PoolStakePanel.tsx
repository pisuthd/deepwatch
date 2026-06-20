'use client';

/**
 * PoolStakePanel — PLP ↔ Subscription NFT via `pool::stake` /
 * `pool::unstake`.
 *
 * # UX
 *
 * Two modes:
 *   - **Stake** — input PLP amount + duration (presets: 7 / 30 / 90
 *     days, plus a free-form input). Sends `pool::stake` → mints
 *     `Subscription` NFT to the wallet.
 *   - **Unstake** — picks the latest non-expired subscription (the
 *     "active" one), burns it, returns the user's pro-rata PLP.
 *
 * Below the toggle, the panel renders the *active* subscription's
 * status: time-remaining, shares, and a green "Access active" badge
 * (or red "Expired" if applicable).
 *
 * # Refresh
 *
 * On any successful PTB we call `useUserPool().refresh()` so the
 * subscription state in the panel and the rest of the page flips
 * immediately — not on the next 30 s poll.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import { Lock, LockOpen, ShieldCheck, ShieldOff, Loader2 } from 'lucide-react';
import GlassCard from '../../common/GlassCard';
import { useNetworkConfig } from '../../../hooks/useNetworkConfig';
import { useUserPool } from '../../../hooks/useUserPool';
import { useDeepWatchPool } from '../../../hooks/useDeepWatchPool';
import { useToast } from '../../../context/ToastContext';
import { buildStakeTx, buildUnstakeTx } from '../../../lib/deepwatch-pool';

const DURATION_PRESETS_DAYS = [7, 30, 90] as const;
const PLP_DECIMALS = 6;

function parsePlpUnits(amount: string): bigint {
  const trimmed = (amount || '').trim();
  if (!trimmed) return BigInt(0);
  const [whole, frac = ''] = trimmed.split('.');
  const fracPadded = (frac + '000000').slice(0, PLP_DECIMALS);
  return BigInt(whole || '0') * BigInt(10 ** PLP_DECIMALS) + BigInt(fracPadded || '0');
}

function fmtPlp(units: bigint, decimals = PLP_DECIMALS): string {
  const whole = units / BigInt(10 ** decimals);
  const frac = units % BigInt(10 ** decimals);
  return `${whole.toString()}.${frac.toString().padStart(decimals, '0').slice(0, 2)}`;
}

function fmtTtl(ms: number): string {
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days}d ${Math.floor((ms % 86_400_000) / 3_600_000)}h`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m`;
}

export default function PoolStakePanel() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const suiClient = useCurrentClient();
  const cfg = useNetworkConfig();
  const { subscription, subscribeTtl, refresh: refreshUserPool } = useUserPool();
  
  console.log("subscription:", subscription)
  
  const { refresh: refreshPool } = useDeepWatchPool();
  const { notify } = useToast();

  const [mode, setMode] = useState<'stake' | 'unstake'>('stake');
  const [amount, setAmount] = useState<string>('');
  const [durationDays, setDurationDays] = useState<number>(
    Math.floor(cfg.deepwatch.defaultStakeDurationMs / (24 * 60 * 60 * 1000)),
  );
  const [submitting, setSubmitting] = useState<boolean>(false);

  // PLP coin state — read once on mount + after each successful PTB.
  const [plpCoinId, setPlpCoinId] = useState<string | null>(null);
  const [plpBalance, setPlpBalance] = useState<bigint>(BigInt(0));

  const refreshPlp = useCallback(async () => {
    if (!account?.address || !cfg.deepwatch.plpCoinType) return;
    try {
      const res = await suiClient.core.listCoins({
        owner: account.address,
        coinType: cfg.deepwatch.plpCoinType,
        limit: 50,
      });
      const coins = res.objects ?? [];
      if (coins.length === 0) {
        setPlpCoinId(null);
        setPlpBalance(BigInt(0));
        return;
      }
      const sorted = [...coins].sort((a, b) => {
        const ab = BigInt(a.balance);
        const bb = BigInt(b.balance);
        return ab > bb ? -1 : ab < bb ? 1 : 0;
      });
      setPlpCoinId(sorted[0].objectId);
      setPlpBalance(
        coins.reduce(
          (acc: bigint, c: { balance: string }) => acc + BigInt(c.balance),
          BigInt(0),
        ),
      );
    } catch {
      setPlpCoinId(null);
      setPlpBalance(BigInt(0));
    }
  }, [account, cfg.deepwatch.plpCoinType, suiClient]);

  useEffect(() => {
    // setTimeout(0) puts the initial fetch in an event-handler context
    // so React 19's set-state-in-effect rule stays happy.
    const initialId = setTimeout(() => {
      void refreshPlp();
    }, 0);
    return () => clearTimeout(initialId);
  }, [refreshPlp]);

  const parsed = parsePlpUnits(amount);
  const insufficient = parsed > plpBalance;
  const durationMs = durationDays * 24 * 60 * 60 * 1000;

  const handleStake = async () => {
    if (!account?.address) return;
    if (parsed <= BigInt(0)) return;
    if (insufficient) return;
    if (!plpCoinId) return;
    const signAndExecute = dAppKit?.signAndExecuteTransaction;
    if (!signAndExecute) {
      notify('Connect a wallet to stake.', { variant: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      const tx = new Transaction();
      const plpCoin = tx.object(plpCoinId);
      const [splitCoin] = tx.splitCoins(plpCoin, [tx.pure.u64(parsed.toString())]);
      buildStakeTx({
        tx,
        deepwatchPackageId: cfg.deepwatch.packageId!,
        poolObjectId: cfg.deepwatch.poolObjectId!,
        plpType: cfg.deepwatch.plpCoinType!,
        collateralType: cfg.coins.SUI,
        plpCoinInput: splitCoin,
        durationMs,
        recipient: account.address
      });
      tx.setGasBudget(50_000_000);
      await signAndExecute({ transaction: tx });
      notify(`Staked ${fmtPlp(parsed)} PLP for ${durationDays} days`, { variant: 'success' });
      setAmount('');
      await refreshUserPool();
      await refreshPlp();
      await refreshPool();
    } catch (e: unknown) {
      const err = e as { message?: string };
      notify(err.message ?? 'Stake failed', { variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnstake = async () => {
    if (!subscription) return;
    const signAndExecute = dAppKit?.signAndExecuteTransaction;
    if (!signAndExecute) {
      notify('Connect a wallet to unstake.', { variant: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      const tx = new Transaction();
      buildUnstakeTx({
        tx,
        deepwatchPackageId: cfg.deepwatch.packageId!,
        poolObjectId: cfg.deepwatch.poolObjectId!,
        plpType: cfg.deepwatch.plpCoinType!,
        collateralType: cfg.coins.SUI,
        subscriptionObjectInput: tx.object(subscription.objectId),
      });
      tx.setGasBudget(50_000_000);
      await signAndExecute({ transaction: tx });
      notify('Unstaked — Subscription burned', { variant: 'success' });
      await refreshUserPool();
      await refreshPlp();
      await refreshPool();
    } catch (e: unknown) {
      const err = e as { message?: string };
      notify(err.message ?? 'Unstake failed', { variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const hasActiveSubscription = subscription != null;
  const accessOk = hasActiveSubscription;
  const configured =
    cfg.deepwatch.packageId !== null &&
    cfg.deepwatch.poolObjectId !== null &&
    cfg.deepwatch.plpCoinType !== null;

  const ttlText = useMemo(() => {
    if (!subscription) return '—';
    // `subscribeTtl` is computed inside `useUserPool` from its own
    // ticking `now` state, so we never read `Date.now()` here in render.
    return fmtTtl(subscribeTtl);
  }, [subscription, subscribeTtl]);

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-3">
        {mode === 'stake' ? (
          <Lock size={18} className="text-accent-primary" />
        ) : (
          <LockOpen size={18} className="text-accent-primary" />
        )}
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Pool stake
        </h2>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          PLP → Subscription NFT
        </span>
      </div>

      {/* Active subscription status */}
      <div className="flex items-center gap-2 mb-3 text-sm">
        {accessOk ? (
          <ShieldCheck size={16} className="text-accent-primary" />
        ) : (
          <ShieldOff size={16} className="text-red-400" />
        )}
        <span className={accessOk ? 'text-accent-primary' : 'text-red-400'}>
          {accessOk ? 'Access active' : hasActiveSubscription ? 'Subscription expired' : 'No active subscription'}
        </span>
        {subscription && (
          <span className="ml-auto text-xs text-[var(--color-text-muted)] font-mono">
            expires in {ttlText}
          </span>
        )}
      </div>

      {!configured ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          DeepWatch pool is not deployed on this network. Staking is unavailable.
        </p>
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setMode('stake')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mode === 'stake'
                  ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                  : 'bg-white/5 border-white/10 text-[var(--color-text-secondary)] hover:bg-white/10'
              }`}
            >
              Stake
            </button>
            <button
              type="button"
              onClick={() => setMode('unstake')}
              disabled={!subscription}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mode === 'unstake'
                  ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                  : 'bg-white/5 border-white/10 text-[var(--color-text-secondary)] hover:bg-white/10'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Unstake
            </button>
          </div>

          {mode === 'stake' ? (
            <>
              <div className="text-xs text-[var(--color-text-muted)] mb-1">
                Wallet PLP: <span className="font-mono">{fmtPlp(plpBalance)}</span>
              </div>
              <input
                type="text"
                inputMode="decimal"
                placeholder="10 PLP"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={submitting || !account}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[var(--color-text-primary)] font-mono text-sm focus:outline-none focus:border-accent-primary"
              />
              {insufficient && (
                <p className="mt-2 text-xs text-red-400">Insufficient PLP balance.</p>
              )}
              <div className="flex gap-2 mt-3">
                {DURATION_PRESETS_DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDurationDays(d)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      durationDays === d
                        ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                        : 'bg-white/5 border-white/10 text-[var(--color-text-secondary)] hover:bg-white/10'
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleStake}
                disabled={submitting || parsed <= BigInt(0) || insufficient || !account || !plpCoinId}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-black font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-primary-hover transition-colors"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Stake {amount || '0'} PLP for {durationDays} days
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--color-text-muted)] mb-2">
                Burns the active Subscription NFT and returns your pro-rata PLP
                (shares × treasury / totalShares).
              </p>
              <button
                type="button"
                onClick={handleUnstake}
                disabled={submitting || !subscription || !account}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/90 text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-500 transition-colors"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Unstake &amp; burn Subscription
              </button>
            </>
          )}
        </>
      )}
    </GlassCard>
  );
}
