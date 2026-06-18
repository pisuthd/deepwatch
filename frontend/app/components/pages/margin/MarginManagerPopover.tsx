'use client';

import { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useMargin, type MarginManagerInfo } from '../../../hooks/useMargin';
import { useMarginMarkets } from '../../../hooks/useMarginMarkets';

interface MarginManagerPopoverProps {
  onClose: () => void;
}

const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';

function shortId(id: string): string {
  if (!id) return '—';
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/**
 * Popover listing the user's MarginManagers (one per pool) with quick
 * create / paste-id actions. Mirrors the visual style of
 * `AccountOverviewPopover` on the predict page.
 */
export default function MarginManagerPopover({ onClose }: MarginManagerPopoverProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { managers, createMarginManager, addManager, loading } = useMargin();
  const { markets: marginMarkets } = useMarginMarkets();

  // Map pool display name (e.g. "DEEP/SUI") to the on-chain pool key
  // (e.g. "DEEP_SUI") — that's what `useMargin` registers managers under.
  const poolKeyOf = (m: { baseAssetSymbol: string; quoteAssetSymbol: string }) =>
    `${m.baseAssetSymbol}_${m.quoteAssetSymbol}`;
  const labelOf = (m: { baseAssetSymbol: string; quoteAssetSymbol: string }) =>
    `${m.baseAssetSymbol}/${m.quoteAssetSymbol}`;
  const labelByPoolKey: Record<string, string> = Object.fromEntries(
    marginMarkets.map((m) => [poolKeyOf(m), labelOf(m)]),
  );

  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasteValue, setPasteValue] = useState('');

  const handleCreate = async (poolKey: string) => {
    if (!dAppKit?.signAndExecuteTransaction) return;
    setCreating(poolKey);
    setError(null);
    try {
      await createMarginManager(dAppKit.signAndExecuteTransaction, poolKey);
    } catch (e: any) {
      setError(e?.message ?? 'Create failed');
    } finally {
      setCreating(null);
    }
  };

  const handleAddExisting = () => {
    const id = pasteValue.trim();
    if (!id) return;
    // The user picks the pool from a small dropdown so we can register the
    // (managerId, poolKey) pair with the SDK config. Default to the first
    // pool the user has not yet bound.
    const usedPools = new Set(managers.map((m) => m.poolKey));
    const free =
      marginMarkets.map(poolKeyOf).find((p) => !usedPools.has(p)) ??
      (marginMarkets[0] ? poolKeyOf(marginMarkets[0]) : undefined);
    if (!free) return;
    const m: MarginManagerInfo = {
      id,
      poolKey: free,
      baseBalance: 0,
      quoteBalance: 0,
      deepBalance: 0,
      borrowedBase: 0,
      borrowedQuote: 0,
    };
    addManager(m);
    setPasteValue('');
    setPasting(false);
  };

  if (!account) {
    return (
      <div className="absolute bottom-full mb-2 right-0 z-40 w-[460px] rounded-2xl border border-white/10 p-5 text-center"
        style={{ background: 'rgba(26, 29, 46, 0.95)', backdropFilter: 'blur(20px)' }}
      >
        <p className="text-sm" style={{ color: textSecondary }}>
          Connect your wallet to manage margin positions.
        </p>
        <button
          onClick={onClose}
          className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: 'rgba(255,255,255,0.08)', color: textSecondary }}
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div
      className="absolute bottom-full mb-2 right-0 z-40 w-[460px] max-h-[80vh] overflow-y-auto rounded-2xl border border-white/10"
      style={{
        background: 'rgba(26, 29, 46, 0.95)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      {/* Header */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5"
        style={{ background: 'rgba(26, 29, 46, 0.95)' }}
      >
        <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
          Margin Managers
          <span className="ml-2 text-[10px] font-mono font-normal" style={{ color: textMuted }}>
            {managers.length}
          </span>
        </h3>
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
      <div className="relative z-10 p-4 space-y-3">
        {error && (
          <div
            className="rounded-md p-2.5 text-xs"
            style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5' }}
          >
            {error}
          </div>
        )}

        {/* Existing managers */}
        {managers.length === 0 ? (
          <p className="text-xs text-center py-3" style={{ color: textMuted }}>
            No margin managers yet. Create one below to start trading with leverage.
          </p>
        ) : (
          <div className="space-y-2">
            {managers.map((m) => (
              <div
                key={m.id}
                className="rounded-lg p-3"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold" style={{ color: textPrimary }}>
                    {labelByPoolKey[m.poolKey] ?? m.poolKey}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: textMuted }}>
                    {shortId(m.id)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <Row label="Base" value={m.baseBalance.toFixed(4)} />
                  <Row label="Quote" value={m.quoteBalance.toFixed(4)} />
                  <Row label="DEEP" value={m.deepBalance.toFixed(4)} />
                  <Row
                    label="Borrowed"
                    value={`${m.borrowedBase.toFixed(4)} / ${m.borrowedQuote.toFixed(4)}`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create new */}
        <div
          className="rounded-lg p-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: textSecondary }}>
            Create Margin Manager
          </div>
          {marginMarkets.length === 0 ? (
            <p className="text-[10px]" style={{ color: textMuted }}>
              No margin markets available on this network yet.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {marginMarkets.map((m) => {
                const poolKey = poolKeyOf(m);
                const hasManager = managers.some((x) => x.poolKey === poolKey);
                return (
                  <button
                    key={poolKey}
                    onClick={() => handleCreate(poolKey)}
                    disabled={creating !== null || hasManager || loading}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: hasManager ? 'rgba(255,255,255,0.04)' : green,
                      color: hasManager ? textMuted : '#000',
                    }}
                  >
                    {creating === poolKey ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : hasManager ? (
                      <span>✓</span>
                    ) : (
                      <Plus size={12} />
                    )}
                    {labelOf(m)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Paste existing manager ID */}
        <div
          className="rounded-lg p-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <button
            onClick={() => setPasting((v) => !v)}
            className="text-[10px] uppercase tracking-wide"
            style={{ color: textSecondary }}
          >
            {pasting ? 'Cancel' : 'Add existing manager by id'}
          </button>
          {pasting && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                placeholder="0x..."
                className="flex-1 px-2 py-1.5 rounded-md text-xs font-mono bg-black/30 border border-white/10 text-white outline-none focus:border-white/30"
              />
              <button
                onClick={handleAddExisting}
                disabled={!pasteValue.trim()}
                className="px-3 py-1.5 rounded-md text-xs font-semibold disabled:opacity-50"
                style={{ background: green, color: '#000' }}
              >
                Add
              </button>
            </div>
          )}
          <p className="text-[10px] mt-2" style={{ color: textMuted }}>
            Paste the on-chain object id of a MarginManager you already own.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: '#9ca3af' }}>{label}</span>
      <span className="font-mono" style={{ color: '#ffffff' }}>{value}</span>
    </div>
  );
}
