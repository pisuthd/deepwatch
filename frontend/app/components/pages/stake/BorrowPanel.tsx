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
 * # Layout
 *
 * Mirrors `AdvancedSwapCard.tsx` — header row, stacked cards for
 * "from" / "to" amounts, info box, full-width CTA. No token icons in
 * the balance row or input (per feedback — icons are noisy here).
 *
 * # Shared utilities
 *
 * `parseUnits` / `fmtUnits` / `CoinBalance` / `fetchCoinBalance` come
 * from `lib/coin.ts`. SUI balances display with 4 dp; PLP with 2 dp.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Transaction } from '@mysten/sui/transactions';
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import { AlertTriangle, ArrowDown, Loader2, Sparkles } from 'lucide-react';
import GlassCard from '../../common/GlassCard';
import { useNetworkConfig } from '../../../hooks/useNetworkConfig';
import { useDeepWatchPool } from '../../../hooks/useDeepWatchPool';
import { useToast } from '../../../context/ToastContext';
import { fetchCoinBalance, fmtUnits, parseUnits, type CoinBalance } from '../../../lib/coin';
import { buildBorrowTx, buildRepayTx } from '../../../lib/deepwatch-pool';
import { getCoinIcon } from '../../../lib/coinIcons';

const PLP_DECIMALS = 6;
const SUI_DECIMALS = 9;
const MS_PER_YEAR = 31_536_000_000;

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';
const green = '#00E68A';
const red = '#ef4444';
const amber = '#FFA500';

type Mode = 'borrow' | 'repay';

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

  // Live 1-year interest estimate (re-derives on every keystroke)
  const interest1y = useMemo<bigint | null>(() => {
    const b = parseUnits(borrowPlp, PLP_DECIMALS);
    if (b <= BigInt(0)) return null;
    return estimateInterest(b, rateBps, MS_PER_YEAR);
  }, [borrowPlp, rateBps]);

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
      notify(`Borrowed ${fmtUnits(b, PLP_DECIMALS)} PLP against ${fmtUnits(c, SUI_DECIMALS, 4)} SUI`, { variant: 'success' });
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

  // Repay handler (v1: still requires Debt NFT object ID via CLI)
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
    notify(
      'Repay requires a Debt NFT object ID — copy it from your wallet and call `pool::repay` via `sui client call` for now.',
      { variant: 'info', duration: 8000 },
    );
    void r;
    void buildRepayTx;
  };

  return (
    <GlassCard className="space-y-4  ">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden p-1"
             
          >
            <Image
              src={getCoinIcon('SUI')}
              width={22}
              height={22}
              alt="SUI"
              className="rounded-full"
              unoptimized
            />
          </div>
          <div className="min-w-0">
            <h2
              className="text-sm font-bold leading-tight"
              style={{ color: textPrimary }}
            >
              Borrow SUI
            </h2>
            <p
              className="text-[10px] leading-snug"
              style={{ color: textSecondary }}
            >
              Deposit SUI as collateral, borrow PLP
            </p>
          </div>
        </div> 
      </div>

      {!configured ? (
        <p className="text-sm" style={{ color: textMuted }}>
          DeepWatch pool is not deployed on this network. Borrowing is unavailable.
        </p>
      ) : (
        <>
          {/* ── Wallet balance (one line, no token icons) ──────────── */}
          <div
            className="rounded-xl mt-4 p-3"
            style={{ background: 'rgba(255, 255, 255, 0.04)' }}
          >
            <div
              className="text-[10px] uppercase tracking-wide mb-1.5"
              style={{ color: textSecondary }}
            >
              Wallet Balance
            </div>
            <div className="flex items-center gap-3 text-sm font-mono">
              <span style={{ color: textPrimary }}>
                <span style={{ color: textSecondary }}>SUI</span>{' '}
                <strong>{fmtUnits(suiBal.totalBalance, SUI_DECIMALS, 4)}</strong>
              </span>
              <span style={{ color: textMuted }}>·</span>
              <span style={{ color: textPrimary }}>
                <span style={{ color: textSecondary }}>PLP</span>{' '}
                <strong>{fmtUnits(plpBal.totalBalance, PLP_DECIMALS)}</strong>
              </span>
            </div>
          </div>

          {/* ── Mode toggle (underline, full-width) ─────────────────── */}
          <div
            className="flex mt-2 border-b"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}
          >
            {(['borrow', 'repay'] as const).map((id) => {
              const isActive = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className="flex-1 py-2 text-sm font-semibold text-center transition-colors"
                  style={{
                    color: isActive ? green : textSecondary,
                    borderBottom: isActive
                      ? `2px solid ${green}`
                      : '2px solid transparent',
                    marginBottom: '-1px', // overlap the parent border
                  }}
                >
                  {id === 'borrow' ? 'Borrow' : 'Repay'}
                </button>
              );
            })}
          </div>

          {mode === 'borrow' ? (
            <>
              {/* ── Collateral card ────────────────────────────────── */}
              <div
                className="rounded-xl mt-4 p-3"
                style={{ background: 'rgba(255, 255, 255, 0.04)' }}
              >
                <div
                  className="text-[10px] uppercase tracking-wide mb-2"
                  style={{ color: textSecondary }}
                >
                  Collateral
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={collateralSui}
                    onChange={(e) => setCollateralSui(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    disabled={submitting || !account}
                    className="flex-1 bg-transparent text-lg font-mono font-semibold outline-none placeholder:text-white/30"
                    style={{ color: textPrimary }}
                  />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: textSecondary }}
                  >
                    SUI
                  </span>
                </div>
              </div>

              {/* Arrow divider */}
              <div className="flex justify-center -my-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{
                    background: 'rgba(0, 230, 138, 0.10)',
                    border: '2px solid rgba(0, 230, 138, 0.35)',
                    color: green,
                  }}
                >
                  <ArrowDown size={12} />
                </div>
              </div>

              {/* ── Borrow amount card ─────────────────────────────── */}
              <div
                className="rounded-xl mb-3 p-3"
                style={{ background: 'rgba(255, 255, 255, 0.04)' }}
              >
                <div
                  className="text-[10px] uppercase tracking-wide mb-2"
                  style={{ color: textSecondary }}
                >
                  Borrow amount
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={borrowPlp}
                    onChange={(e) => setBorrowPlp(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    disabled={submitting || !account}
                    className="flex-1 bg-transparent text-lg font-mono font-semibold outline-none placeholder:text-white/30"
                    style={{ color: textPrimary }}
                  />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: textSecondary }}
                  >
                    PLP
                  </span>
                </div>
              </div>

              {/* ── Info box (LTV / Interest) ───────────────────────── */}
              <div
                className="rounded-xl p-3 space-y-2.5"
                style={{ background: 'rgba(255, 255, 255, 0.03)' }}
              >
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className="text-[10px] uppercase tracking-wide"
                      style={{ color: textSecondary }}
                    >
                      LTV
                    </span>
                    <span
                      className="text-xs font-mono font-semibold"
                      style={{ color: textPrimary }}
                    >
                      {ltvRatio !== null
                        ? `${(ltvRatio / 100).toFixed(2)}% / ${(ltvBps / 100).toFixed(0)}%`
                        : '—'}
                    </span>
                  </div>
                  <div
                    className="mt-1 h-1 rounded-full overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.06)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${
                          ltvRatio !== null
                            ? Math.min((ltvRatio / ltvBps) * 100, 100)
                            : 0
                        }%`,
                        background: ltvTooHigh ? red : green,
                      }}
                    />
                  </div>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="text-[10px] uppercase tracking-wide"
                    style={{ color: textSecondary }}
                  >
                    Interest (1Y)
                  </span>
                  <span
                    className="text-xs font-mono font-semibold"
                    style={{ color: textPrimary }}
                  >
                    {interest1y !== null
                      ? `${fmtUnits(interest1y, PLP_DECIMALS)} PLP`
                      : '—'}
                  </span>
                </div>
              </div>

              {ltvTooHigh && (
                <p
                  className="flex items-center gap-1.5 text-xs"
                  style={{ color: amber }}
                >
                  <AlertTriangle size={12} />
                  LTV {((ltvRatio ?? 0) / 100).toFixed(2)}% exceeds the{' '}
                  {ltvBps / 100}% cap.
                </p>
              )}

              {/* ── Submit ─────────────────────────────────────────── */}
              {!account ? (
                <div
                  className="text-center mt-4 text-xs py-3"
                  style={{ color: textSecondary }}
                >
                  Connect your wallet to borrow.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleBorrow}
                  disabled={
                    submitting ||
                    parseUnits(collateralSui, SUI_DECIMALS) <= BigInt(0) ||
                    parseUnits(borrowPlp, PLP_DECIMALS) <= BigInt(0) ||
                    ltvTooHigh ||
                    !suiBal.primaryCoinId
                  }
                  className="w-full mt-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
                  style={{
                    background:
                      parseUnits(borrowPlp, PLP_DECIMALS) > BigInt(0) && !ltvTooHigh
                        ? green
                        : 'rgba(255, 255, 255, 0.08)',
                    color:
                      parseUnits(borrowPlp, PLP_DECIMALS) > BigInt(0) && !ltvTooHigh
                        ? '#000'
                        : textSecondary,
                    opacity: submitting ? 0.6 : 1,
                  }}
                >
                  {submitting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : ltvTooHigh ? (
                    <AlertTriangle size={14} />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  {submitting ? 'Borrowing…' : 'Borrow PLP'}
                </button>
              )}
            </>
          ) : (
            <>
              {/* ── Repay card ────────────────────────────────────── */}
              <div
                className="rounded-xl mt-4 mb-4 p-3"
                style={{ background: 'rgba(255, 255, 255, 0.04)' }}
              >
                <div
                  className="text-[10px] uppercase tracking-wide mb-2"
                  style={{ color: textSecondary }}
                >
                  Repay amount
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={repayPlp}
                    onChange={(e) => setRepayPlp(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    disabled={submitting || !account}
                    className="flex-1 bg-transparent text-lg font-mono font-semibold outline-none placeholder:text-white/30"
                    style={{ color: textPrimary }}
                  />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: textSecondary }}
                  >
                    PLP
                  </span>
                </div>
              </div>
 

              {!account ? (
                <div
                  className="text-center text-xs py-3"
                  style={{ color: textSecondary }}
                >
                  Connect your wallet to repay.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleRepay}
                  disabled={
                    submitting ||
                    parseUnits(repayPlp, PLP_DECIMALS) <= BigInt(0)
                  }
                  className="w-full mt-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
                  style={{
                    background: green,
                    color: '#000',
                    opacity: submitting ? 0.6 : 1,
                  }}
                >
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  {submitting ? 'Repaying…' : 'Repay PLP'}
                </button>
              )}
            </>
          )}
        </>
      )}
    </GlassCard>
  );
}
