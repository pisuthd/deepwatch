'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usePredict, PRICE_SCALE } from '../../../hooks/usePredict';
import { useMargin } from '../../../hooks/useMargin';
import { useMarginMarkets } from '../../../hooks/useMarginMarkets';
import { useToast } from '../../../context/ToastContext';
import { formatPrice } from './utils';

type Mode = 'binary' | 'range';
type Direction = 'up' | 'down';

interface LeveragedBetModalProps {
  oracleId: string | null;
  expiryMs: number;
  spotUsd: number;
  mode: Mode;
  /** Strike (binary mode). */
  strike?: number;
  /** Range bounds (range mode). */
  lower?: number;
  higher?: number;
  onClose: () => void;
  /** Visibility. When false the modal renders nothing. */
  open?: boolean;
}

const CLOCK = '0x6';
const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';

/**
 * Leveraged-bet modal. Single PTB: borrow DBUSDC from a MarginManager →
 * withdraw → split wallet collateral → merge → deposit into PredictManager
 * → mint. The borrow stays open after; repay from the Margin page.
 *
 * If the user has no MarginManager for the chosen pool, we prompt them to
 * create one (separate signature) before re-opening the bet.
 */
export default function LeveragedBetModal({
  oracleId,
  expiryMs,
  spotUsd,
  mode,
  strike,
  lower,
  higher,
  onClose,
  open = true,
}: LeveragedBetModalProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { manager } = usePredict();
  const { managersByPool, createMarginManager, leveragedPredictBet } = useMargin();
  const { markets: marginMarkets } = useMarginMarkets();
  const { notify } = useToast();

  // Filter margin markets to only those whose quote asset is DBUSDC. The
  // leveraged-bet flow only borrows DBUSDC (no swap leg).
  const dbusdcQuoteMarkets = useMemo(
    () => marginMarkets.filter((m) => m.quoteAssetSymbol === 'DBUSDC'),
    [marginMarkets],
  );

  const [poolIdx, setPoolIdx] = useState(0);
  const [leverage, setLeverage] = useState(2);
  const [collateral, setCollateral] = useState('');
  const [direction, setDirection] = useState<Direction>('up');
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clamp poolIdx when the list shrinks (e.g. network switch, or first
  // render before the indexer responds). Without this, `markets[poolIdx]`
  // would be `undefined` and the modal would silently fail to render.
  const safePoolIdx = dbusdcQuoteMarkets.length === 0
    ? 0
    : Math.min(poolIdx, dbusdcQuoteMarkets.length - 1);
  const market = dbusdcQuoteMarkets[safePoolIdx];
  const poolKey = market?.market.replace('/', '_') ?? '';
  const marginManager = managersByPool.get(poolKey);

  const stops = useMemo(() => [1.5, 2, 3, 5], []);
  const collateralNum = parseFloat(collateral) || 0;
  const totalBet = collateralNum * leverage;
  const borrowU6 = BigInt(Math.round(collateralNum * (leverage - 1) * 1e6));
  const collateralU6 = BigInt(Math.round(collateralNum * 1e6));

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCreateManager = async () => {
    if (!dAppKit?.signAndExecuteTransaction) return;
    setCreating(true);
    setError(null);
    try {
      await createMarginManager(dAppKit.signAndExecuteTransaction, poolKey);
    } catch (e: any) {
      setError(e?.message ?? 'Create margin manager failed');
    } finally {
      setCreating(false);
    }
  };

  const handleSubmit = async () => {
    if (
      !account ||
      !dAppKit?.signAndExecuteTransaction ||
      !oracleId ||
      !expiryMs ||
      collateralNum <= 0 ||
      !manager ||
      !marginManager
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const PREDICT_PKG =
        (manager as any)?.package_id ??
        '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
      const PREDICT_OBJECT =
        (manager as any)?.predict_object_id ??
        '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
      const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';

      const buildKeyAndMint = (tx: any) => {
        if (mode === 'binary') {
          const s = strike ?? spotUsd;
          const key = tx.moveCall({
            target: `${PREDICT_PKG}::market_key::${direction}`,
            arguments: [
              tx.pure.u64(BigInt(Math.round(s * 1e9))),
              tx.pure.u64(BigInt(expiryMs)),
            ],
          });
          tx.moveCall({
            target: `${PREDICT_PKG}::predict::mint`,
            typeArguments: [DUSDC_TYPE],
            arguments: [
              tx.object(PREDICT_OBJECT),
              tx.object(manager.manager_id),
              tx.pure.id(oracleId),
              key,
              tx.pure.u64(collateralU6 * BigInt(leverage)),
              tx.object(CLOCK),
            ],
          });
        } else {
          const lo = lower ?? 0;
          const hi = higher ?? 0;
          const key = tx.moveCall({
            target: `${PREDICT_PKG}::range_key::new`,
            arguments: [
              tx.pure.u64(BigInt(Math.round(lo * 1e9))),
              tx.pure.u64(BigInt(Math.round(hi * 1e9))),
              tx.pure.u64(BigInt(expiryMs)),
            ],
          });
          tx.moveCall({
            target: `${PREDICT_PKG}::predict::mint_range`,
            typeArguments: [DUSDC_TYPE],
            arguments: [
              tx.object(PREDICT_OBJECT),
              tx.object(manager.manager_id),
              tx.pure.id(oracleId),
              key,
              tx.pure.u64(collateralU6 * BigInt(leverage)),
              tx.object(CLOCK),
            ],
          });
        }
      };

      await leveragedPredictBet(dAppKit.signAndExecuteTransaction, {
        marginManagerId: marginManager.id,
        marginPoolKey: poolKey,
        predictPackageId: PREDICT_PKG,
        predictObjectId: PREDICT_OBJECT,
        predictManagerId: manager.manager_id,
        dusdcType: DUSDC_TYPE,
        borrowU6,
        collateralU6,
        buildKeyAndMint,
      });
      notify(
        `Leveraged bet placed · ${leverage}× · ${mode === 'binary' ? direction.toUpperCase() : `${formatPrice(lower!)}–${formatPrice(higher!)}`}`,
        { variant: 'success' },
      );
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Leveraged bet failed');
    } finally {
      setSubmitting(false);
    }
  };

  const valid = collateralNum > 0 && !!manager && !!marginManager && !!oracleId && !!expiryMs;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10"
        style={{
          background: 'rgba(26, 29, 46, 0.95)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
              ⚡ Leveraged Bet
            </h3>
            <p className="text-[10px] mt-0.5" style={{ color: textMuted }}>
              {mode === 'binary'
                ? `${direction.toUpperCase()} @ ${strike ? formatPrice(strike) : '—'}`
                : `${lower ? formatPrice(lower) : '—'}–${higher ? formatPrice(higher) : '—'}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: textSecondary }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="relative p-5 space-y-4">
          {!manager ? (
            <p className="text-xs" style={{ color: textSecondary }}>
              You need a Predict account first. Place a regular bet to create one, then come back for leverage.
            </p>
          ) : !marginManager ? (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: textSecondary }}>
                You don't have a Margin Manager for {market?.market ?? 'this pool'}. Create one to enable leveraged bets.
              </p>
              <button
                onClick={handleCreateManager}
                disabled={creating}
                className="w-full py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: green, color: '#000' }}
              >
                {creating && <Loader2 size={14} className="animate-spin" />}
                {creating ? 'Creating…' : `Create Margin Manager (${market?.market ?? poolKey})`}
              </button>
            </div>
          ) : (
            <>
              {/* Direction (binary only) */}
              {mode === 'binary' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDirection('up')}
                    className="py-2 rounded-lg text-xs font-bold transition-all"
                    style={{
                      background: direction === 'up' ? green : 'rgba(255,255,255,0.04)',
                      color: direction === 'up' ? '#000' : textSecondary,
                      border: `1px solid ${direction === 'up' ? green : 'rgba(255,255,255,0.08)'}`,
                    }}
                  >
                    UP
                  </button>
                  <button
                    onClick={() => setDirection('down')}
                    className="py-2 rounded-lg text-xs font-bold transition-all"
                    style={{
                      background: direction === 'down' ? red : 'rgba(255,255,255,0.04)',
                      color: direction === 'down' ? '#fff' : textSecondary,
                      border: `1px solid ${direction === 'down' ? red : 'rgba(255,255,255,0.08)'}`,
                    }}
                  >
                    DOWN
                  </button>
                </div>
              )}

              {/* Pool */}
              <div>
                <label className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                  Margin pool
                </label>
                <select
                  value={safePoolIdx}
                  onChange={(e) => setPoolIdx(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm font-mono text-white outline-none focus:border-white/30"
                  disabled={dbusdcQuoteMarkets.length === 0}
                >
                  {dbusdcQuoteMarkets.length === 0 && (
                    <option value={0} style={{ background: '#1a1d2e' }}>
                      No DBUSDC-quote margin pools available
                    </option>
                  )}
                  {dbusdcQuoteMarkets.map((m, i) => (
                    <option key={m.market} value={i} style={{ background: '#1a1d2e' }}>
                      {m.market}
                    </option>
                  ))}
                </select>
              </div>

              {/* Leverage */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                    Leverage
                  </span>
                  <span className="text-sm font-bold" style={{ color: cyan }}>
                    {leverage}×
                  </span>
                </div>
                <div className="flex gap-2">
                  {stops.map((s) => (
                    <button
                      key={s}
                      onClick={() => setLeverage(s)}
                      className="flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors"
                      style={{
                        background: s === leverage ? cyan : 'rgba(255,255,255,0.04)',
                        color: s === leverage ? '#000' : textSecondary,
                      }}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              </div>

              {/* Collateral */}
              <div>
                <label className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                  Collateral (DBUSDC)
                </label>
                <input
                  type="number"
                  value={collateral}
                  onChange={(e) => setCollateral(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  className="w-full mt-1 px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 text-sm font-mono text-white outline-none focus:border-white/30"
                />
              </div>

              {/* Summary */}
              <div
                className="rounded-lg p-3 grid grid-cols-2 gap-3 text-[11px]"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <Row label="Bet size" value={`${totalBet.toFixed(2)} DBUSDC`} />
                <Row label="From wallet" value={`${collateralNum.toFixed(2)} DBUSDC`} />
                <Row label="Borrowed" value={`${(collateralNum * (leverage - 1)).toFixed(2)} DBUSDC`} />
                <Row
                  label="Margin pool"
                  value={market?.market ?? poolKey}
                />
              </div>
            </>
          )}

          {error && (
            <div
              className="rounded-md p-2.5 text-xs"
              style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5' }}
            >
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || !valid || creating}
            className="w-full py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: valid ? green : 'rgba(255,255,255,0.08)', color: valid ? '#000' : textMuted }}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting
              ? 'Signing…'
              : valid
                ? `Place Leveraged Bet · ${leverage}×`
                : 'Set up to continue'}
          </button>

          <p className="text-[10px] text-center" style={{ color: textMuted }}>
            Borrow stays open after this PTB. Repay from the Margin page.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: textSecondary }}>{label}</span>
      <span className="font-mono" style={{ color: textPrimary }}>
        {value}
      </span>
    </div>
  );
}
