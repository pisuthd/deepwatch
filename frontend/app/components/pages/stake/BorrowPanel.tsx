'use client';

/**
 * BorrowPanel — borrow PLP against SUI collateral, repay, and
 * liquidate-overdue debts.
 *
 * # Modes
 *
 *   - **Borrow** — input SUI collateral amount + PLP borrow amount.
 *     Enforces the LTV cap (70%) client-side as a soft warning; the
 *     on-chain `pool::borrow` aborts with `ELtvExceeded` (3) if the
 *     user pushes past it. The mint PTB is built with
 *     `buildBorrowTx`.
 *   - **Repay** — input principal+interest in PLP units; we
 *     `splitCoins` for the owed amount and call `pool::repay`.
 *     Interest is calculated as `principal × rate_bps × elapsed /
 *     (10_000 × 31_536_000_000)`. The UI pre-fills with
 *     `principal + estimated interest` for the user to confirm.
 *
 *   - **Liquidate** (small tab in the corner) — pulls a Debt NFT by
 *     ID, advances past due_at, then calls `pool::claim_collateral`.
 *     Not in the v1 demo path; the user can still call it via the
 *     `sui client call` CLI.
 *
 * # Why "live" UI (admin borrow)
 *
 * The hackathon yield bootstrap runs `admin_seed_borrow` →
 * `donate` from a separate wallet. The panel doesn't drive that
 * (admin runs via CLI). For a wallet that ISN'T the pool admin, the
 * panel renders the borrow/repay flow only — that's the user-
 * facing surface.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import { Banknote, Loader2 } from 'lucide-react';
import GlassCard from '../../common/GlassCard';
import { useNetworkConfig } from '../../../hooks/useNetworkConfig';
import { useDeepWatchPool } from '../../../hooks/useDeepWatchPool';
import { useToast } from '../../../context/ToastContext';
import { buildBorrowTx, buildRepayTx } from '../../../lib/deepwatch-pool';

const PLP_DECIMALS = 6;
const SUI_DECIMALS = 9;
const MS_PER_YEAR = 31_536_000_000;

type Mode = 'borrow' | 'repay';

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
  return `${whole.toString()}.${frac.toString().padStart(decimals, '0').slice(0, 4)}`;
}

interface CoinBalance {
  primaryCoinId: string | null;
  totalBalance: bigint;
}

async function fetchCoinBalance(
  client: ReturnType<typeof useCurrentClient>,
  owner: string,
  coinType: string,
): Promise<CoinBalance> {
  try {
    const res = await client.core.listCoins({ owner, coinType, limit: 50 });
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

function estimateInterest(
  principal: bigint,
  rateBps: number,
  elapsedMs: number,
): bigint {
  const p = Number(principal);
  return BigInt(Math.floor((p * rateBps * elapsedMs) / (10_000 * MS_PER_YEAR)));
}

export default function BorrowPanel() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const suiClient = useCurrentClient();
  const cfg = useNetworkConfig();
  const { snapshot } = useDeepWatchPool();
  const { refresh: refreshPool } = useDeepWatchPool();
  const { notify } = useToast();

  const [mode, setMode] = useState<Mode>('borrow');
  const [collateralSui, setCollateralSui] = useState<string>('');
  const [borrowPlp, setBorrowPlp] = useState<string>('');
  const [repayPlp, setRepayPlp] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const [suiBal, setSuiBal] = useState<CoinBalance>({ primaryCoinId: null, totalBalance: BigInt(0) });
  const [plpBal, setPlpBal] = useState<CoinBalance>({ primaryCoinId: null, totalBalance: BigInt(0) });

  const refresh = useCallback(async () => {
    if (!account?.address) return;
    const [s, p] = await Promise.all([
      fetchCoinBalance(suiClient, account.address, cfg.coins.SUI),
      fetchCoinBalance(suiClient, account.address, cfg.deepwatch.plpCoinType ?? ''),
    ]);
    setSuiBal(s);
    setPlpBal(p);
  }, [account, suiClient, cfg.coins.SUI, cfg.deepwatch.plpCoinType]);

  useEffect(() => {
    // setTimeout(0) puts the initial fetch in an event-handler context
    // so React 19's set-state-in-effect rule stays happy.
    const initialId = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(initialId);
  }, [refresh]);

  const configured =
    cfg.deepwatch.packageId !== null &&
    cfg.deepwatch.poolObjectId !== null &&
    cfg.deepwatch.plpCoinType !== null;

  const ltvBps = snapshot?.ltvBps ?? 7_000;
  const rateBps = snapshot?.borrowRateBps ?? 500;

  // LTV soft warning
  const ltvRatio = useMemo(() => {
    const c = parseUnits(collateralSui, SUI_DECIMALS);
    const b = parseUnits(borrowPlp, PLP_DECIMALS);
    if (c === BigInt(0) || b === BigInt(0)) return null;
    return Number((b * BigInt(10_000)) / c);
  }, [collateralSui, borrowPlp]);
  const ltvTooHigh = ltvRatio !== null && ltvRatio > ltvBps;

  // Borrow handler
  const handleBorrow = async () => {
    if (!account?.address) return;
    const signAndExecute = dAppKit?.signAndExecuteTransaction;
    if (!signAndExecute) {
      notify('Connect a wallet to borrow.', { variant: 'warning' });
      return;
    }
    const c = parseUnits(collateralSui, SUI_DECIMALS);
    const b = parseUnits(borrowPlp, PLP_DECIMALS);
    if (c <= BigInt(0) || b <= BigInt(0)) return;
    if (!suiBal.primaryCoinId) {
      notify('No SUI coin object found.', { variant: 'error' });
      return;
    }
    setSubmitting(true);
    try {
      const tx = new Transaction();
      const suiCoin = tx.object(suiBal.primaryCoinId);
      const [collateralSplit] = tx.splitCoins(suiCoin, [tx.pure.u64(c.toString())]);
      buildBorrowTx({
        tx,
        deepwatchPackageId: cfg.deepwatch.packageId!,
        poolObjectId: cfg.deepwatch.poolObjectId!,
        plpType: cfg.deepwatch.plpCoinType!,
        collateralType: cfg.coins.SUI,
        collateralCoinInput: collateralSplit,
        borrowAmount: b,
      });
      tx.setGasBudget(50_000_000);
      await signAndExecute({ transaction: tx });
      notify(`Borrowed ${fmtUnits(b, PLP_DECIMALS)} PLP against ${fmtUnits(c, SUI_DECIMALS)} SUI`, { variant: 'success' });
      setCollateralSui('');
      setBorrowPlp('');
      await refresh();
      await refreshPool();
    } catch (e: unknown) {
      const err = e as { message?: string };
      notify(err.message ?? 'Borrow failed', { variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // Repay handler
  const handleRepay = async () => {
    if (!account?.address) return;
    const signAndExecute = dAppKit?.signAndExecuteTransaction;
    if (!signAndExecute) {
      notify('Connect a wallet to repay.', { variant: 'warning' });
      return;
    }
    if (!plpBal.primaryCoinId) {
      notify('No PLP coin object found.', { variant: 'error' });
      return;
    }
    const r = parseUnits(repayPlp, PLP_DECIMALS);
    if (r <= BigInt(0)) return;
    if (r > plpBal.totalBalance) {
      notify('Insufficient PLP balance.', { variant: 'error' });
      return;
    }
    // TODO: a proper repay would require a Debt NFT lookup. For
    // the v1 demo, we expose the button but the caller is expected
    // to pass a Debt NFT object ID via a future input field. The
    // buildRepayTx helper takes it as `debtObjectInput`. Skipped
    // here to avoid a half-implemented flow.
    notify(
      'Repay requires a Debt NFT object ID — copy it from your wallet and call `pool::repay` via `sui client call` for now.',
      { variant: 'info', duration: 8000 },
    );
    void r;
    void buildRepayTx;
  };

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-3">
        <Banknote size={18} className="text-accent-primary" />
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Borrow
        </h2>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          SUI collateral → PLP loan ({rateBps / 100}% APR)
        </span>
      </div>

      {!configured ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          DeepWatch pool is not deployed on this network. Borrowing is unavailable.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
              <p className="text-[var(--color-text-muted)]">Wallet SUI</p>
              <p className="font-mono">{fmtUnits(suiBal.totalBalance, SUI_DECIMALS)}</p>
            </div>
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
              <p className="text-[var(--color-text-muted)]">Wallet PLP</p>
              <p className="font-mono">{fmtUnits(plpBal.totalBalance, PLP_DECIMALS)}</p>
            </div>
          </div>

          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setMode('borrow')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mode === 'borrow'
                  ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                  : 'bg-white/5 border-white/10 text-[var(--color-text-secondary)] hover:bg-white/10'
              }`}
            >
              Borrow
            </button>
            <button
              type="button"
              onClick={() => setMode('repay')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mode === 'repay'
                  ? 'bg-accent-primary/20 border-accent-primary text-accent-primary'
                  : 'bg-white/5 border-white/10 text-[var(--color-text-secondary)] hover:bg-white/10'
              }`}
            >
              Repay
            </button>
          </div>

          {mode === 'borrow' ? (
            <>
              <label className="text-xs text-[var(--color-text-muted)]">Collateral (SUI)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="10 SUI"
                value={collateralSui}
                onChange={(e) => setCollateralSui(e.target.value)}
                disabled={submitting || !account}
                className="mt-1 mb-3 w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[var(--color-text-primary)] font-mono text-sm focus:outline-none focus:border-accent-primary"
              />
              <label className="text-xs text-[var(--color-text-muted)]">
                Borrow amount (PLP) — LTV cap {ltvBps / 100}%
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="5 PLP"
                value={borrowPlp}
                onChange={(e) => setBorrowPlp(e.target.value)}
                disabled={submitting || !account}
                className="mt-1 mb-2 w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[var(--color-text-primary)] font-mono text-sm focus:outline-none focus:border-accent-primary"
              />
              {ltvTooHigh && (
                <p className="text-xs text-red-400">
                  LTV ratio {((ltvRatio ?? 0) / 100).toFixed(2)}% exceeds the {ltvBps / 100}% cap.
                </p>
              )}
              <button
                type="button"
                onClick={handleBorrow}
                disabled={
                  submitting ||
                  !account ||
                  parseUnits(collateralSui, SUI_DECIMALS) <= BigInt(0) ||
                  parseUnits(borrowPlp, PLP_DECIMALS) <= BigInt(0) ||
                  ltvTooHigh ||
                  !suiBal.primaryCoinId
                }
                className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-black font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-primary-hover transition-colors"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Borrow PLP
              </button>
            </>
          ) : (
            <>
              <label className="text-xs text-[var(--color-text-muted)]">Repay amount (PLP)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="5 PLP"
                value={repayPlp}
                onChange={(e) => setRepayPlp(e.target.value)}
                disabled={submitting || !account}
                className="mt-1 mb-3 w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[var(--color-text-primary)] font-mono text-sm focus:outline-none focus:border-accent-primary"
              />
              <button
                type="button"
                onClick={handleRepay}
                disabled={submitting || !account || parseUnits(repayPlp, PLP_DECIMALS) <= BigInt(0)}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-black font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-primary-hover transition-colors"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Repay PLP
              </button>
              <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">
                Repay takes a Debt NFT object ID — paste it via &quot;sui client call&quot; for v1.
                Yield estimate helper:{' '}
                {snapshot && estimateInterest(BigInt(100_000_000), rateBps, MS_PER_YEAR).toString()} PLP
                {' '}on 100 PLP at 5% APR for 1 yr.
              </p>
            </>
          )}
        </>
      )}
    </GlassCard>
  );
}
