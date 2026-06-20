/**
 * PoolStakeFormBody — PLP ↔ Subscription NFT via `pool::stake` /
 * `pool::unstake`.
 *
 * Extracted from the original `PoolStakePanel` so the same form can
 * render inside two surfaces:
 *   1. `PoolStakePanel` — GlassCard inline (backward-compat).
 *   2. `PoolStakeModal` — centered modal frame opened from the Pools
 *      tab on the redesigned Stake page.
 *
 * # UX
 *
 * Two modes:
 *   - **Stake** — input PLP amount + duration (presets: 7 / 30 / 90
 *     days). Sends `pool::stake` → mints `Subscription` NFT to the
 *     wallet.
 *   - **Unstake** — picks the active (latest non-expired) subscription,
 *     burns it, returns pro-rata PLP.
 *
 * Renders the active subscription's status (TTL + access badge) above
 * the toggle so the user always sees whether AI access is currently on.
 *
 * # Refresh
 *
 * On any successful PTB we call `useUserPool().refresh()`,
 * `useDeepWatchPool().refresh()` so the panel + page see fresh state
 * immediately (not on the 30 s poll).
 *
 * # Duration default
 *
 * Initial duration is `cfg.deepwatch.defaultStakeDurationMs` converted
 * to days. If the config value is 0 (unset) or maps to a value not in
 * the preset chip row [7, 30, 90], we fall back to 30 so the user
 * never lands on "0d" with no preset selected.
 *
 * # Shared utilities
 *
 * `parseUnits` / `fmtUnits` / `CoinBalance` / `fetchCoinBalance` come
 * from `lib/coin.ts` — see that file for the rationale.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import { Lock, LockOpen, ShieldCheck, ShieldOff, Loader2 } from 'lucide-react';
import { useNetworkConfig } from '../../../hooks/useNetworkConfig';
import { useUserPool } from '../../../hooks/useUserPool';
import { useDeepWatchPool } from '../../../hooks/useDeepWatchPool';
import { useToast } from '../../../context/ToastContext';
import { fetchCoinBalance, fmtUnits, parseUnits, type CoinBalance } from '../../../lib/coin';
import { buildStakeTx, buildUnstakeTx } from '../../../lib/deepwatch-pool';

const DURATION_PRESETS_DAYS = [7, 30, 90] as const;
const PLP_DECIMALS = 6;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;

function fmtTtl(ms: number): string {
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / MS_PER_DAY);
  if (days >= 1) return `${days}d ${Math.floor((ms % 86_400_000) / 3_600_000)}h`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m`;
}

/**
 * Convert `defaultStakeDurationMs` to a day count, clamping to the
 * nearest preset. If the config value is 0 or otherwise doesn't land
 * on a preset, fall back to `DEFAULT_DAYS`. The result is always in
 * `DURATION_PRESETS_DAYS`.
 */
function resolveDefaultDurationDays(ms: number): number {
  const days = Math.floor(ms / MS_PER_DAY);
  return (DURATION_PRESETS_DAYS as readonly number[]).includes(days) ? days : DEFAULT_DAYS;
}

export interface PoolStakeFormBodyProps {
  /** Initial mode for the form body. Defaults to 'stake'. */
  defaultMode?: 'stake' | 'unstake';
}

export function PoolStakeFormBody({
  defaultMode = 'stake',
}: PoolStakeFormBodyProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const suiClient = useCurrentClient();
  const cfg = useNetworkConfig();
  const { subscription, subscribeTtl, refresh: refreshUserPool } = useUserPool();

  const { refresh: refreshPool } = useDeepWatchPool();
  const { notify } = useToast();

  const [mode, setMode] = useState<'stake' | 'unstake'>(defaultMode);
  const [amount, setAmount] = useState<string>('');
  const [durationDays, setDurationDays] = useState<number>(
    resolveDefaultDurationDays(cfg.deepwatch.defaultStakeDurationMs),
  );
  const [submitting, setSubmitting] = useState<boolean>(false);

  // PLP coin state — read once on mount + after each successful PTB.
  const [plpCoin, setPlpCoin] = useState<CoinBalance>({ primaryCoinId: null, totalBalance: BigInt(0) });

  const refreshPlp = useCallback(async () => {
    if (!account?.address || !cfg.deepwatch.plpCoinType) return;
    const bal = await fetchCoinBalance(suiClient, account.address, cfg.deepwatch.plpCoinType);
    setPlpCoin(bal);
  }, [account, cfg.deepwatch.plpCoinType, suiClient]);

  useEffect(() => {
    // setTimeout(0) puts the initial fetch in an event-handler context
    // so React 19's set-state-in-effect rule stays happy.
    const initialId = setTimeout(() => {
      void refreshPlp();
    }, 0);
    return () => clearTimeout(initialId);
  }, [refreshPlp]);

  const parsed = parseUnits(amount, PLP_DECIMALS);
  const insufficient = parsed > plpCoin.totalBalance;
  const durationMs = durationDays * MS_PER_DAY;

  const handleStake = async () => {
    if (!account?.address) return;
    if (parsed <= BigInt(0)) return;
    if (insufficient) return;
    if (!plpCoin.primaryCoinId) return;
    const signAndExecute = dAppKit?.signAndExecuteTransaction;
    if (!signAndExecute) {
      notify('Connect a wallet to stake.', { variant: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      const tx = new Transaction();
      const plpCoinInput = tx.object(plpCoin.primaryCoinId);
      const [splitCoin] = tx.splitCoins(plpCoinInput, [tx.pure.u64(parsed.toString())]);
      buildStakeTx({
        tx,
        deepwatchPackageId: cfg.deepwatch.packageId!,
        poolObjectId: cfg.deepwatch.poolObjectId!,
        plpType: cfg.deepwatch.plpCoinType!,
        collateralType: cfg.coins.SUI,
        plpCoinInput: splitCoin,
        durationMs,
        recipient: account.address,
      });
      tx.setGasBudget(50_000_000);
      await signAndExecute({ transaction: tx });
      notify(`Staked ${fmtUnits(parsed, PLP_DECIMALS)} PLP for ${durationDays} days`, { variant: 'success' });
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
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {mode === 'stake' ? (
          <Lock size={16} className="text-accent-primary" />
        ) : (
          <LockOpen size={16} className="text-accent-primary" />
        )}
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          PLP → Subscription NFT
        </span>
      </div>

      {/* Active subscription status */}
      <div className="flex items-center gap-2 text-sm">
        {accessOk ? (
          <ShieldCheck size={16} className="text-accent-primary" />
        ) : (
          <ShieldOff size={16} className="text-red-400" />
        )}
        <span className={accessOk ? 'text-accent-primary' : 'text-red-400'}>
          {accessOk
            ? 'Access active'
            : hasActiveSubscription
              ? 'Subscription expired'
              : 'No active subscription'}
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
          <div className="flex gap-2">
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
              <div className="text-xs text-[var(--color-text-muted)]">
                Wallet PLP: <span className="font-mono">{fmtUnits(plpCoin.totalBalance, PLP_DECIMALS)}</span>
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
                <p className="text-xs text-red-400">Insufficient PLP balance.</p>
              )}
              <div className="flex gap-2">
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
                disabled={submitting || parsed <= BigInt(0) || insufficient || !account || !plpCoin.primaryCoinId}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-black font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-primary-hover transition-colors"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Stake {amount || '0'} PLP for {durationDays} days
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--color-text-muted)]">
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
    </div>
  );
}

export default PoolStakeFormBody;
