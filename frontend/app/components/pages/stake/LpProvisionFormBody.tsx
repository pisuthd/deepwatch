/**
 * LpProvisionFormBody — DUSDC ↔ PLP via raw `predict::supply` /
 * `predict::withdraw`.
 *
 * Extracted from the original `LpProvisionPanel` so the same form can
 * render inside two surfaces:
 *   1. `LpProvisionPanel` — GlassCard inline (backward-compat for any
 *      current consumer).
 *   2. `LpProvisionModal` — centered modal frame opened from the Pools
 *      tab on the redesigned Stake page.
 *
 * The body owns all the logic (mode toggle, amount parsing, balance
 * fetching, PTB building, error handling) — neither the panel nor the
 * modal frame duplicates it.
 *
 * The PTB path is unchanged: splitCoins the largest matching coin
 * object, then call `buildPredictSupplyTx` / `buildPredictWithdrawTx`
 * with `tx.setGasBudget(50_000_000)`. After a successful tx, the
 * user's balances + PoolSnapshot refresh immediately via
 * `useUserPool().refresh()` and `useDeepWatchPool().refresh()`.
 *
 * `parseUnits` / `fmtUnits` / `CoinBalance` / `fetchCoinBalance` come
 * from `lib/coin.ts` — see that file for the rationale and the
 * silent-on-failure contract.
 */

import { useCallback, useEffect, useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import { ArrowDownUp, Loader2 } from 'lucide-react';
import { useNetworkConfig } from '../../../hooks/useNetworkConfig';
import { useUserPool } from '../../../hooks/useUserPool';
import { useDeepWatchPool } from '../../../hooks/useDeepWatchPool';
import { useToast } from '../../../context/ToastContext';
import { fetchCoinBalance, fmtUnits, parseUnits, type CoinBalance } from '../../../lib/coin';
import {
  buildPredictSupplyTx,
  buildPredictWithdrawTx,
} from '../../../lib/deepwatch-pool';

const DUSDC_DECIMALS = 6;
const PLP_DECIMALS = 6;

type Mode = 'deposit' | 'withdraw';

export interface LpProvisionFormBodyProps {
  /** Initial mode for the form body. Defaults to 'deposit'. */
  defaultMode?: Mode;
}

export function LpProvisionFormBody({
  defaultMode = 'deposit',
}: LpProvisionFormBodyProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const suiClient = useCurrentClient();
  const cfg = useNetworkConfig();
  const { refresh: refreshUserPool } = useUserPool();
  const { refresh: refreshPool } = useDeepWatchPool();
  const { notify } = useToast();

  const [mode, setMode] = useState<Mode>(defaultMode);
  const [amount, setAmount] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [dusdc, setDusdc] = useState<CoinBalance>({ primaryCoinId: null, totalBalance: BigInt(0) });
  const [plp, setPlp] = useState<CoinBalance>({ primaryCoinId: null, totalBalance: BigInt(0) });

  const dusdcType = cfg.predict.dusdcType;
  const plpType = cfg.deepwatch.plpCoinType;
  const predictOk = cfg.predict.packageId !== null && cfg.predict.objectId !== null && dusdcType !== null;
  const plpOk = plpType !== null;

  const refresh = useCallback(async () => {
    if (!account?.address || !dusdcType || !plpType) return;
    const [d, p] = await Promise.all([
      fetchCoinBalance(suiClient, account.address, dusdcType),
      fetchCoinBalance(suiClient, account.address, plpType),
    ]);
    setDusdc(d);
    setPlp(p);
  }, [account, dusdcType, plpType, suiClient]);

  useEffect(() => {
    // setTimeout(0) puts the initial fetch in an event-handler context
    // so React 19's set-state-in-effect rule stays happy.
    const initialId = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(initialId);
  }, [refresh]);

  const parsed = parseUnits(amount, DUSDC_DECIMALS);
  const valid = parsed > BigInt(0);
  const insufficient =
    (mode === 'deposit' && parsed > dusdc.totalBalance) ||
    (mode === 'withdraw' && parsed > plp.totalBalance);

  const handleSubmit = async () => {
    if (!account?.address) return;
    if (!valid || insufficient) return;
    if (!predictOk) return;
    const signAndExecute = dAppKit?.signAndExecuteTransaction;
    if (!signAndExecute) {
      notify('Connect a wallet to deposit / withdraw.', { variant: 'warning' });
      return;
    }

    setSubmitting(true);
    try {
      const tx = new Transaction();
      const primaryCoinId = mode === 'deposit' ? dusdc.primaryCoinId : plp.primaryCoinId;
      if (!primaryCoinId) throw new Error(`No ${mode === 'deposit' ? 'DUSDC' : 'PLP'} coin object found`);
      const primaryCoin = tx.object(primaryCoinId);
      const [splitCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(parsed.toString())]);

      if (mode === 'deposit') {
        buildPredictSupplyTx({
          tx,
          predictPackageId: cfg.predict.packageId!,
          predictObjectId: cfg.predict.objectId!,
          dusdcType: dusdcType!,
          paymentCoinInput: splitCoin,
          recipient: account.address,
        });
      } else {
        buildPredictWithdrawTx({
          tx,
          predictPackageId: cfg.predict.packageId!,
          predictObjectId: cfg.predict.objectId!,
          dusdcType: dusdcType!,
          plpCoinInput: splitCoin,
          recipient: account.address,
        });
      }
      tx.setGasBudget(50_000_000);

      await signAndExecute({ transaction: tx });
      notify(
        `${mode === 'deposit' ? 'Deposited' : 'Withdrew'} ${fmtUnits(parsed, DUSDC_DECIMALS)} ${mode === 'deposit' ? 'DUSDC → PLP' : 'PLP → DUSDC'}`,
        { variant: 'success' },
      );
      setAmount('');
      await refresh();
      await refreshUserPool();
      await refreshPool();
    } catch (e: unknown) {
      const err = e as { message?: string; code?: number };
      notify(err.message ?? 'LP provision failed', { variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ArrowDownUp size={16} className="text-accent-primary" />
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          DUSDC ↔ DeepBook PLP
        </span>
      </div>

      {!predictOk || !plpOk ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Predict is not deployed on this network. LP provision is unavailable.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
              <p className="text-[var(--color-text-muted)]">Wallet DUSDC</p>
              <p className="font-mono">{fmtUnits(dusdc.totalBalance, DUSDC_DECIMALS)}</p>
            </div>
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
              <p className="text-[var(--color-text-muted)]">Wallet PLP</p>
              <p className="font-mono">{fmtUnits(plp.totalBalance, PLP_DECIMALS)}</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('deposit')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mode === 'deposit'
                  ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                  : 'bg-white/5 border-white/10 text-[var(--color-text-secondary)] hover:bg-white/10'
              }`}
            >
              Deposit
            </button>
            <button
              type="button"
              onClick={() => setMode('withdraw')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mode === 'withdraw'
                  ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                  : 'bg-white/5 border-white/10 text-[var(--color-text-secondary)] hover:bg-white/10'
              }`}
            >
              Withdraw
            </button>
          </div>

          <input
            type="text"
            inputMode="decimal"
            placeholder={mode === 'deposit' ? '100 DUSDC' : '100 PLP'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={submitting || !account}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[var(--color-text-primary)] font-mono text-sm focus:outline-none focus:border-accent-primary"
          />
          {insufficient && (
            <p className="text-xs text-red-400">
              Insufficient {mode === 'deposit' ? 'DUSDC' : 'PLP'} balance.
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !valid || insufficient || !account}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-black font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-primary-hover transition-colors"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {mode === 'deposit' ? 'Deposit DUSDC → PLP' : 'Withdraw PLP → DUSDC'}
          </button>
        </>
      )}
    </div>
  );
}

export default LpProvisionFormBody;
