'use client';

/**
 * LpProvisionPanel — DUSDC ↔ PLP via raw `predict::supply` /
 * `predict::withdraw`. The "LP provision" layer that sits beneath
 * the DeepWatch second-layer pool.
 *
 * # UX
 *
 * Two modes side-by-side, toggle via a small [Deposit | Withdraw]
 * chip group. The amount input is a human DUSDC string (e.g. "100")
 * — converted to raw u6 units inside the submit handler.
 *
 * # Single-coin simplification
 *
 * We pick the *largest* DUSDC coin object on the wallet and call
 * `splitCoins` inside the PTB. If the wallet has multiple DUSDC
 * objects and the user wants to deposit from all of them, they
 * should consolidate in a separate PTB first. This matches the
 * hackathon scope — the focus is the staking feature, not LP
 * provisioning UX polish.
 *
 * # Refresh
 *
 * After a successful tx, we re-fetch coin balances and notify
 * `useUserPool().refresh()` so the page picks up the new PLP
 * balance immediately (without waiting for the 30 s poll).
 */

import { useCallback, useEffect, useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import { ArrowDownUp, Loader2 } from 'lucide-react';
import GlassCard from '../../common/GlassCard';
import { useNetworkConfig } from '../../../hooks/useNetworkConfig';
import { useUserPool } from '../../../hooks/useUserPool';
import { useToast } from '../../../context/ToastContext';
import {
  buildPredictSupplyTx,
  buildPredictWithdrawTx,
  type PoolErrors,
} from '../../../lib/deepwatch-pool';

const DUSDC_DECIMALS = 6;
const PLP_DECIMALS = 6;

type Mode = 'deposit' | 'withdraw';

function parseUnits(amount: string, decimals: number): bigint {
  const trimmed = (amount || '').trim();
  if (!trimmed) return BigInt(0);
  const [whole, frac = ''] = trimmed.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * BigInt(10 ** decimals) + BigInt(fracPadded || '0');
}

function fmtUnits(units: bigint, decimals: number): string {
  const whole = units / BigInt(10 ** decimals);
  const frac = units % BigInt(10 ** decimals);
  return `${whole.toString()}.${frac.toString().padStart(decimals, '0').slice(0, 2)}`;
}

interface CoinBalance {
  /** Largest single coin object for this type. */
  primaryCoinId: string | null;
  /** Sum across all coin objects. */
  totalBalance: bigint;
}

async function fetchCoinBalance(
  suiClient: ReturnType<typeof useCurrentClient>,
  owner: string,
  coinType: string,
): Promise<CoinBalance> {
  try {
    const res = await suiClient.core.listCoins({ owner, coinType, limit: 50 });
    const coins = res.objects ?? [];
    if (coins.length === 0) return { primaryCoinId: null, totalBalance: BigInt(0) };
    const sorted = [...coins].sort((a, b) => {
      const ab = BigInt(a.balance);
      const bb = BigInt(b.balance);
      return ab > bb ? -1 : ab < bb ? 1 : 0;
    });
    const totalBalance = coins.reduce(
      (acc: bigint, c: { balance: string }) => acc + BigInt(c.balance),
      BigInt(0),
    );
    return { primaryCoinId: sorted[0].objectId, totalBalance };
  } catch {
    return { primaryCoinId: null, totalBalance: BigInt(0) };
  }
}

export default function LpProvisionPanel() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const suiClient = useCurrentClient();
  const cfg = useNetworkConfig();
  const { refresh: refreshUserPool } = useUserPool();
  const { notify } = useToast();

  const [mode, setMode] = useState<Mode>('deposit');
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
    console.log("p:", p)
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
    } catch (e: unknown) {
      const err = e as { message?: string; code?: number };
      const code = typeof err.code === 'number' ? err.code : null;
      notify(err.message ?? 'LP provision failed', { variant: 'error' });
      void code; // surfaced via err.message; reserved for PoolErrors mapping if needed
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-3">
        <ArrowDownUp size={18} className="text-accent-primary" />
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          LP provision
        </h2>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          DUSDC ↔ PLP via predict::supply / predict::withdraw
        </span>
      </div>

      {!predictOk || !plpOk ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Predict is not deployed on this network. LP provision is unavailable.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
              <p className="text-[var(--color-text-muted)]">Wallet DUSDC</p>
              <p className="font-mono">{fmtUnits(dusdc.totalBalance, DUSDC_DECIMALS)}</p>
            </div>
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
              <p className="text-[var(--color-text-muted)]">Wallet PLP</p>
              <p className="font-mono">{fmtUnits(plp.totalBalance, PLP_DECIMALS)}</p>
            </div>
          </div>

          <div className="flex gap-2 mb-3">
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
            <p className="mt-2 text-xs text-red-400">
              Insufficient {mode === 'deposit' ? 'DUSDC' : 'PLP'} balance.
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !valid || insufficient || !account}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-black font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-primary-hover transition-colors"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {mode === 'deposit' ? 'Deposit DUSDC → PLP' : 'Withdraw PLP → DUSDC'}
          </button>
        </>
      )}
    </GlassCard>
  );
}

// Re-export PoolErrors type so other panels can import from this file too
// without creating an import cycle.
export type { PoolErrors };
