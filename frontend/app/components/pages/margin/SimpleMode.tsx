'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import Image from 'next/image';
import GlassCard from '../../common/GlassCard';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useMargin } from '../../../hooks/useMargin';
import { useMarginMarkets, type MarginMarket } from '../../../hooks/useMarginMarkets';
import { useToast } from '../../../context/ToastContext';
import { getCoinIcon } from '../../../lib/coinIcons';
import LeveragedTradeModal from './LeveragedTradeModal';

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';

// Adaptive price formatter — same shape as the spot page so the dropdown
// and the price row read consistently across the two pages.
function formatPrice(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n === 0) return '—';
  if (n >= 10000) {
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  if (n >= 1000) {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (n >= 1) {
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function formatCompact(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n === 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

// USD-quote pools render as `$1.4M`; non-USD pools keep `<num> <ASSET>`.
function formatVolume(quoteAsset: string, volume: number | undefined): string {
  if (volume === undefined || volume === null || !Number.isFinite(volume) || volume === 0) return '—';
  const isUsdQuote = quoteAsset.toUpperCase().includes('USD');
  return isUsdQuote ? `$${formatCompact(volume)}` : `${formatCompact(volume)} ${quoteAsset}`;
}

function Stat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
        {label}
      </span>
      <span
        className="text-sm font-mono font-semibold mt-0.5 truncate"
        style={{ color: valueColor ?? textPrimary }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Simple-mode margin trading page. Mirrors the spot page's layout: the pool
 * selector card is always visible, and a single "actions" card below it
 * always renders. The content inside the actions card swaps based on state
 * (no wallet / no manager / has manager) so the page layout stays stable
 * regardless of connection state — same pattern as `SwapCard.tsx`.
 */
export default function MarginSimpleMode() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { managersByPool, createMarginManager, addManager } = useMargin();
  const { markets: marginMarkets } = useMarginMarkets();
  const { notify } = useToast();

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [poolOpen, setPoolOpen] = useState(false);
  const [modal, setModal] = useState<'long' | 'short' | null>(null);
  const [creating, setCreating] = useState(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);

  // Clamp the selected pool index when the market list shrinks (e.g. network
  // switch). Without this, `markets[selectedIdx]` would be `undefined`.
  const safeIdx = marginMarkets.length === 0
    ? 0
    : Math.min(selectedIdx, marginMarkets.length - 1);
  const market: MarginMarket | undefined = marginMarkets[safeIdx];
  const poolKey = market?.market.replace('/', '_') ?? '';
  const manager = managersByPool.get(poolKey);

  // Close the pair dropdown on outside click (same shape as the spot page).
  useEffect(() => {
    if (!poolOpen) return;
    const handler = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setPoolOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [poolOpen]);

  const handleCreate = async () => {
    console.log('[SimpleMode.handleCreate] clicked', {
      hasDAppKit: !!dAppKit,
      hasSigner: !!dAppKit?.signAndExecuteTransaction,
      market: market?.market,
      poolKey,
      account: !!account,
    });
    if (!dAppKit?.signAndExecuteTransaction || !market) {
      console.warn('[SimpleMode.handleCreate] early return — missing signer or market');
      return;
    }
    setCreating(true);
    try {
      console.log('[SimpleMode.handleCreate] calling createMarginManager, poolKey=', poolKey);
      const newId = await createMarginManager(dAppKit.signAndExecuteTransaction, poolKey);
      console.log('[SimpleMode.handleCreate] createMarginManager returned:', newId);
      if (newId) {
        notify(`Margin manager created for ${market.market}`, { variant: 'success' });
      } else {
        console.warn('[SimpleMode.handleCreate] createMarginManager returned empty id');
        notify('Create did not return a manager id', { variant: 'error' });
      }
    } catch (e: any) {
      console.error('[SimpleMode.handleCreate] threw:', e);
      notify(e?.message ?? 'Create failed', { variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const handlePaste = () => {
    if (!market) {
      console.warn('[SimpleMode.handlePaste] no market selected');
      return;
    }
    const id = window.prompt(`Paste the on-chain MarginManager object id for ${market.market}:`);
    if (!id) return;
    console.log('[SimpleMode.handlePaste] pasted id', id.trim(), 'for poolKey', poolKey);
    addManager({
      id: id.trim(),
      poolKey,
      baseBalance: 0,
      quoteBalance: 0,
      deepBalance: 0,
      borrowedBase: 0,
      borrowedQuote: 0,
    });
    notify(`Linked manager id to ${market.market}`, { variant: 'success' });
  };

  return (
    <div className="max-w-md mx-auto space-y-3">
      {/* Pool selector — always visible, mirrors the spot page's pair-header
          card (overlapping icons, price, 24h change, stats grid). The
          `overflow="visible"` lets the dropdown escape the card. */}
      <GlassCard overflow="visible" className="z-30">
        {market && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div ref={selectorRef} className="relative flex-1 min-w-0">
                <button
                  onClick={() => setPoolOpen((v) => !v)}
                  className="flex items-center gap-2.5 w-full text-left rounded-lg -ml-1 pl-1 pr-2 py-1 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center -space-x-2.5 shrink-0">
                    <Image
                      src={getCoinIcon(market.baseAssetSymbol)}
                      alt={market.baseAssetSymbol}
                      width={30}
                      height={30}
                      className="rounded-full ring-2 ring-[#1A1D2E]"
                    />
                    <Image
                      src={getCoinIcon(market.quoteAssetSymbol)}
                      alt={market.quoteAssetSymbol}
                      width={30}
                      height={30}
                      className="rounded-full ring-2 ring-[#1A1D2E]"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-base font-bold truncate" style={{ color: textPrimary }}>
                        {market.baseAssetSymbol}
                      </span>
                      <span className="text-base font-bold" style={{ color: textSecondary }}>
                        /
                      </span>
                      <span className="text-base font-bold truncate" style={{ color: textPrimary }}>
                        {market.quoteAssetSymbol}
                      </span>
                      <ChevronDown
                        size={14}
                        className={`shrink-0 transition-transform ${poolOpen ? 'rotate-180' : ''}`}
                        style={{ color: textSecondary }}
                      />
                    </div>
                    <div
                      className="text-[10px] uppercase tracking-wide truncate"
                      style={{ color: textSecondary }}
                    >
                      {poolKey}
                    </div>
                  </div>
                </button>

                {poolOpen && (
                  <div
                    className="absolute top-full left-0 right-0 mt-2 py-1 rounded-xl z-50 overflow-hidden max-h-80 overflow-y-auto shadow-2xl"
                    style={{
                      background: 'rgba(22, 25, 34, 0.98)',
                      backdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    {marginMarkets.length === 0 && (
                      <div className="px-3 py-2 text-xs" style={{ color: textMuted }}>
                        No margin markets available
                      </div>
                    )}
                    {marginMarkets.map((m, i) => {
                      const isActive = i === safeIdx;
                      const change = m.change24h ?? 0;
                      return (
                        <button
                          key={m.market}
                          onClick={() => {
                            setSelectedIdx(i);
                            setPoolOpen(false);
                          }}
                          className="w-full px-3 py-2.5 text-left transition-colors"
                          style={{
                            background: isActive ? 'rgba(0, 230, 138, 0.12)' : 'transparent',
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive)
                              (e.currentTarget as HTMLButtonElement).style.background =
                                'rgba(255, 255, 255, 0.04)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive)
                              (e.currentTarget as HTMLButtonElement).style.background =
                                'transparent';
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="flex items-center -space-x-1.5 shrink-0">
                              <Image
                                src={getCoinIcon(m.baseAssetSymbol)}
                                alt={m.baseAssetSymbol}
                                width={20}
                                height={20}
                                className="rounded-full"
                              />
                              <Image
                                src={getCoinIcon(m.quoteAssetSymbol)}
                                alt={m.quoteAssetSymbol}
                                width={20}
                                height={20}
                                className="rounded-full"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div
                                className="text-sm font-semibold truncate"
                                style={{ color: textPrimary }}
                              >
                                {m.baseAssetSymbol}/{m.quoteAssetSymbol}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div
                                className="text-xs font-mono font-semibold"
                                style={{ color: textPrimary }}
                              >
                                {formatPrice(m.lastPrice)}
                              </div>
                              {m.change24h !== undefined && (
                                <div
                                  className="text-[10px] font-mono"
                                  style={{ color: change >= 0 ? green : red }}
                                >
                                  {change >= 0 ? '+' : ''}
                                  {change.toFixed(2)}%
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Price row + 24h change */}
            <div className="mt-3 flex items-baseline gap-2 flex-wrap">
              <span
                className="text-2xl font-bold font-mono leading-none"
                style={{ color: textPrimary }}
              >
                {formatPrice(market.lastPrice)}
              </span>
              <span className="text-xs leading-none" style={{ color: textSecondary }}>
                {market.baseAssetSymbol} per {market.quoteAssetSymbol}
              </span>
              {market.change24h !== undefined && (
                <span
                  className="text-xs font-mono font-semibold ml-auto leading-none"
                  style={{ color: market.change24h >= 0 ? green : red }}
                >
                  {market.change24h >= 0 ? '+' : ''}
                  {market.change24h.toFixed(2)}% · 24h
                </span>
              )}
            </div>

            {/* Stats grid — mirrors spot's 4-column High/Low/Vol/Bid·Ask. */}
            <div
              className="mt-3 grid grid-cols-4 gap-3 pt-3"
              style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
            >
              <Stat label="24h High" value={formatPrice(market.highestPrice24h)} />
              <Stat label="24h Low" value={formatPrice(market.lowestPrice24h)} />
              <Stat
                label="24h Vol"
                value={formatVolume(market.quoteAssetSymbol, market.quoteVolume)}
              />
              <Stat
                label="Bid / Ask"
                value={
                  market.highestBid !== undefined && market.lowestAsk !== undefined
                    ? `${formatPrice(market.highestBid)} / ${formatPrice(market.lowestAsk)}`
                    : '—'
                }
              />
            </div>
          </>
        )}
      </GlassCard>

      {/* Actions card — always visible, like SwapCard's outer wrapper. Only
          the inner content swaps. Mirrors the spot page's `!account` branch
          (small inline text, no big card replacement). */}
      <GlassCard>
        <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: textSecondary }}>
          Quick actions
        </div>

        {!manager ? (
          // No manager for this pool: create button + paste-id escape hatch.
          <>
            <button
              onClick={handleCreate}
              disabled={creating || !market}
              className="w-full py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: green, color: '#000' }}
            >
              {creating && <Loader2 size={14} className="animate-spin" />}
              {creating ? 'Creating…' : 'Create Margin Manager'}
            </button>
            <button
              onClick={handlePaste}
              className="w-full text-[10px] uppercase tracking-wide transition-colors hover:underline mt-2 py-1"
              style={{ color: cyan }}
            >
              <Plus size={10} className="inline-block mr-1 -mt-0.5" />
              Use existing manager id
            </button>
          </>
        ) : market ? (
          // Has manager: balance row + Long/Short action row.
          <>
            <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
              <Row label="Base" value={manager.baseBalance.toFixed(4)} />
              <Row label="Quote" value={manager.quoteBalance.toFixed(4)} />
              <Row label="DEEP" value={manager.deepBalance.toFixed(4)} />
              <Row
                label="Borrowed"
                value={`${manager.borrowedBase.toFixed(4)} / ${manager.borrowedQuote.toFixed(4)}`}
              />
            </div>
            <div className="text-[10px] mb-3 font-mono" style={{ color: textMuted }}>
              {manager.id.slice(0, 8)}…{manager.id.slice(-6)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setModal('long')}
                className="py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
                style={{ background: green, color: '#000' }}
              >
                Long
              </button>
              <button
                onClick={() => setModal('short')}
                className="py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
                style={{ background: red, color: '#fff' }}
              >
                Short
              </button>
            </div>
            {/* <p className="text-[10px] mt-3" style={{ color: textMuted }}>
              Long borrows quote and swaps to base. Short borrows base and swaps to quote.
            </p> */}
          </>
        ) : null}
      </GlassCard>

      {modal && manager && market && (
        <LeveragedTradeModal
          market={market}
          managerId={manager.id}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: textSecondary }}>{label}</span>
      <span className="font-mono" style={{ color: textPrimary }}>{value}</span>
    </div>
  );
}
