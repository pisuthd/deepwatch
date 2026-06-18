'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import Image from 'next/image';
import GlassCard from '../../common/GlassCard';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useMargin } from '../../../hooks/useMargin';
import { useMarginMarkets, type MarginMarket } from '../../../hooks/useMarginMarkets';
import { useSpotPools } from '../../../hooks/useSpotPools';
import { useNetworkConfig } from '../../../hooks/useNetworkConfig';
import { useToast } from '../../../context/ToastContext';
import { getCoinIcon } from '../../../lib/coinIcons';
import CandlestickChart from '../spot/CandlestickChart';
import LeveragedTradeModal from './LeveragedTradeModal';
import BorrowRepayModal from './BorrowRepayModal';

const green = '#00E68A';
const red = '#ef4444';
const amber = '#f59e0b';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

// Same adaptive price formatter as SimpleMode/spot so the pages match.
function formatPrice(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n === 0) return '—';
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
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
        {label}
      </span>
      <span
        className="text-sm font-mono font-semibold truncate"
        style={{ color: valueColor ?? textPrimary }}
      >
        {value}
      </span>
    </div>
  );
}

interface Level2Row {
  price: number;
  size: number;
}

interface OrderBookResponse {
  bids: [string, string][];
  asks: [string, string][];
}

/**
 * Advanced-mode margin trading page. Mirrors the spot page's layout: a
 * spot-parity pool card (rich selector with stats) sits at the top, then a
 * 2-column row of orderbook + candlestick chart, then position/manager/risk
 * cards when a manager is bound, then the trade form. The action row inside
 * the trade form swaps based on state (no manager / has manager) — same
 * pattern as `SwapCard.tsx`.
 */
export default function MarginAdvancedMode() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { markets: marginMarkets } = useMarginMarkets();
  const { managersByPool, createMarginManager, addManager } = useMargin();
  // Reuse the spot hook for chart data — `/ohclv/<pool>` works for any
  // DeepBook pool, spot or margin, so we don't need a second indexer call.
  const { getOHLCV } = useSpotPools();
  const cfg = useNetworkConfig();
  const { notify } = useToast();

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [poolOpen, setPoolOpen] = useState(false);
  const [leverage, setLeverage] = useState(3);
  const [amount, setAmount] = useState('');
  const [modal, setModal] = useState<'long' | 'short' | 'borrow' | null>(null);
  const [creating, setCreating] = useState(false);
  const [chartInterval, setChartInterval] = useState<Interval>('4h');
  const [bids, setBids] = useState<Level2Row[]>([]);
  const [asks, setAsks] = useState<Level2Row[]>([]);
  const selectorRef = useRef<HTMLDivElement | null>(null);

  // Clamp the selected pool index when the market list shrinks (e.g. network
  // switch). Without this, `markets[selectedIdx]` would be `undefined`.
  const safeIdx = marginMarkets.length === 0
    ? 0
    : Math.min(selectedIdx, marginMarkets.length - 1);
  const market: MarginMarket | undefined = marginMarkets[safeIdx];
  const poolKey = market?.market.replace('/', '_') ?? '';
  const manager = managersByPool.get(poolKey);

  // Candles for the active pool. Memoized so the chart's effect doesn't
  // refire on unrelated re-renders.
  const fetchCandles = useCallback(
    async (iv: string) => {
      if (!poolKey) return [];
      return getOHLCV(poolKey, iv, 200);
    },
    [poolKey, getOHLCV],
  );

  // Close the pair dropdown on outside click (matches the spot page).
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

  // Fetch top-of-book for visual context. Driven by the public indexer
  // (wallet-free) so it works even when the wallet isn't connected — unlike
  // the SDK path which requires an account.
  useEffect(() => {
    if (!market) return;
    let cancelled = false;
    const fetchBook = async () => {
      try {
        const url = `${cfg.deepbookIndexer}/orderbook/${poolKey}?level=2&depth=5`;
        console.log('[AdvancedMode] GET orderbook', url);
        const r = await fetch(url);
        console.log('[AdvancedMode] orderbook status', r.status);
        if (!r.ok) return;
        const data: OrderBookResponse = await r.json();
        console.log('[AdvancedMode] orderbook data', { bids: data?.bids?.length, asks: data?.asks?.length });
        if (cancelled) return;
        setBids(
          (data?.bids ?? []).map(([price, size]) => ({
            price: Number(price ?? 0),
            size: Number(size ?? 0),
          })),
        );
        setAsks(
          (data?.asks ?? []).map(([price, size]) => ({
            price: Number(price ?? 0),
            size: Number(size ?? 0),
          })),
        );
      } catch (e) {
        console.warn('[AdvancedMode] orderbook fetch error', e);
        /* ignore — orderbook is decorative */
      }
    };
    fetchBook();
    const id = setInterval(fetchBook, 8_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [cfg.deepbookIndexer, market, poolKey]);

  const handleCreate = async () => {
    console.log('[AdvancedMode.handleCreate] clicked', {
      hasDAppKit: !!dAppKit,
      hasSigner: !!dAppKit?.signAndExecuteTransaction,
      market: market?.market,
      poolKey,
      account: !!account,
    });
    if (!dAppKit?.signAndExecuteTransaction || !market) {
      console.warn('[AdvancedMode.handleCreate] early return — missing signer or market');
      return;
    }
    setCreating(true);
    try {
      console.log('[AdvancedMode.handleCreate] calling createMarginManager, poolKey=', poolKey);
      const newId = await createMarginManager(dAppKit.signAndExecuteTransaction, poolKey);
      console.log('[AdvancedMode.handleCreate] createMarginManager returned:', newId);
      if (newId) notify(`Margin manager created for ${market.market}`, { variant: 'success' });
      else notify('Create did not return a manager id', { variant: 'error' });
    } catch (e: any) {
      console.error('[AdvancedMode.handleCreate] threw:', e);
      notify(e?.message ?? 'Create failed', { variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const handlePaste = () => {
    if (!market) {
      console.warn('[AdvancedMode.handlePaste] no market selected');
      return;
    }
    const id = window.prompt(`Paste the on-chain MarginManager object id for ${market.market}:`);
    if (!id) return;
    console.log('[AdvancedMode.handlePaste] pasted id', id.trim(), 'for poolKey', poolKey);
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
    <div className="max-w-3xl mx-auto space-y-3">
      {/* Pool card (rich, spot-parity) — always visible. The `overflow="visible"`
          lets the dropdown escape the card; bumped z-index keeps it stacked
          above the chart card below. */}
      <GlassCard overflow="visible" className="relative z-30">
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

            {/* Stats grid — same 4-column layout as SimpleMode / spot. */}
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

      {/* Orderbook + chart — orderbook next to the pool card on wide screens,
          chart sits beside it as a 2-col row. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <GlassCard>
          <div className="text-[10px] uppercase tracking-wide mb-2" style={{ color: textSecondary }}>
            Orderbook (top 5)
          </div>
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <div className="flex justify-between mb-1" style={{ color: green }}>
                <span>Bid</span>
                <span className="text-[10px]" style={{ color: textMuted }}>
                  Price / Size
                </span>
              </div>
              <div className="space-y-0.5">
                {bids.length === 0 ? (
                  <div style={{ color: textMuted }}>—</div>
                ) : (
                  bids.map((b, i) => (
                    <div key={i} className="flex justify-between font-mono" style={{ color: textPrimary }}>
                      <span>{b.price.toFixed(4)}</span>
                      <span>{b.size.toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1" style={{ color: red }}>
                <span>Ask</span>
                <span className="text-[10px]" style={{ color: textMuted }}>
                  Price / Size
                </span>
              </div>
              <div className="space-y-0.5">
                {asks.length === 0 ? (
                  <div style={{ color: textMuted }}>—</div>
                ) : (
                  asks.map((a, i) => (
                    <div key={i} className="flex justify-between font-mono" style={{ color: textPrimary }}>
                      <span>{a.price.toFixed(4)}</span>
                      <span>{a.size.toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Chart card — reuses the spot CandlestickChart component. Data
            comes from `useSpotPools().getOHLCV()` which is wallet-free and
            hits the same `/ohclv/<pool>` endpoint that spot uses. Margin
            pools are the same DeepBook V3 pools under the hood, so the
            candle data is identical. */}
        <GlassCard>
          <div className="flex items-center justify-between mb-2">
            <span
              className="text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: textSecondary }}
            >
              Chart
            </span>
            <div className="flex items-center gap-1">
              {INTERVALS.map((iv) => (
                <button
                  key={iv}
                  onClick={() => setChartInterval(iv)}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors"
                  style={{
                    background: iv === chartInterval ? 'rgba(0,230,138,0.15)' : 'rgba(255,255,255,0.04)',
                    color: iv === chartInterval ? green : textSecondary,
                    border: `1px solid ${
                      iv === chartInterval ? 'rgba(0,230,138,0.35)' : 'rgba(255,255,255,0.06)'
                    }`,
                  }}
                >
                  {iv}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[240px]">
            {poolKey ? (
              <CandlestickChart fetchCandles={fetchCandles} interval={chartInterval} />
            ) : (
              <div className="h-full flex items-center justify-center text-xs" style={{ color: textMuted }}>
                Select a market to view its chart.
              </div>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Position / Manager / Risk cards — show whenever a manager is bound
          to the selected pool. Visible to no-wallet users who paste an id,
          since balances are stored client-side after paste. */}
      {manager && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <GlassCard>
            <div className="text-[10px] font-semibold mb-2" style={{ color: textSecondary }}>
              Position
            </div>
            <Row label="Size" value="—" />
            <Row label="Entry" value="—" />
            <Row label="uPnL" value="—" />
          </GlassCard>
          <GlassCard>
            <div className="text-[10px] font-semibold mb-2" style={{ color: textSecondary }}>
              Manager
            </div>
            <Row label="Base" value={manager.baseBalance.toFixed(4)} />
            <Row label="Quote" value={manager.quoteBalance.toFixed(4)} />
            <Row label="DEEP" value={manager.deepBalance.toFixed(4)} />
          </GlassCard>
          <GlassCard>
            <div className="text-[10px] font-semibold mb-2" style={{ color: textSecondary }}>
              Risk
            </div>
            <Row label="Borrowed" value={`${manager.borrowedBase.toFixed(4)} / ${manager.borrowedQuote.toFixed(4)}`} />
            <Row label="Liq. price" value="—" valueColor={red} />
            <Row label="Margin ratio" value="—" valueColor={amber} />
          </GlassCard>
        </div>
      )}

      {/* Trade form — always visible, like SwapCard's outer wrapper. Only
          the action row inside swaps based on state. Mirrors the spot page
          pattern (small inline "Connect your wallet to..." text, no big
          card replacement). */}
      <GlassCard>
        {/* Leverage + amount always render — these are inputs, not actions. */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: textSecondary }}>
                Leverage
              </span>
              <span className="text-sm font-bold" style={{ color: green }}>
                {leverage}×
              </span>
            </div>
            <div className="relative h-2 rounded-full mb-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="absolute top-0 left-0 h-full rounded-full transition-all"
                style={{ width: `${(leverage / 10) * 100}%`, background: green }}
              />
            </div>
            <div className="flex justify-between gap-1">
              {[1, 2, 3, 5, 7, 10].map((s) => (
                <button
                  key={s}
                  onClick={() => setLeverage(s)}
                  className="text-[11px] w-9 h-7 rounded-md transition-colors"
                  style={{
                    background: s === leverage ? green : 'rgba(255,255,255,0.05)',
                    color: s === leverage ? '#000' : textSecondary,
                    fontWeight: s === leverage ? 700 : 500,
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                Size
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm font-mono text-white outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                Total (× leverage)
              </label>
              <div
                className="w-full mt-1 px-3 py-2 rounded-lg text-sm font-mono"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: textPrimary,
                }}
              >
                {((parseFloat(amount) || 0) * leverage).toFixed(2)}
              </div>
            </div>
          </div>

          {/* Action row — only swaps on manager presence (not on account). The
              page is meant to be useful as a read-only preview, so the trade
              buttons stay visible. Handlers early-return without a wallet, so
              clicking is safe. */}
          {!manager ? (
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
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setModal('long')}
                className="py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
                style={{ background: green, color: '#000' }}
              >
                Open Long
              </button>
              <button
                onClick={() => setModal('short')}
                className="py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
                style={{ background: red, color: '#fff' }}
              >
                Open Short
              </button>
              <button
                onClick={() => setModal('borrow')}
                className="py-2.5 rounded-lg font-semibold text-sm transition-colors hover:bg-white/10"
                style={{ background: 'rgba(255,255,255,0.05)', color: textPrimary }}
              >
                Borrow / Repay
              </button>
            </div>
          )}
        </div>
      </GlassCard>

      {modal === 'long' && manager && market && (
        <LeveragedTradeModal market={market} managerId={manager.id} onClose={() => setModal(null)} />
      )}
      {modal === 'short' && manager && market && (
        <LeveragedTradeModal market={market} managerId={manager.id} onClose={() => setModal(null)} />
      )}
      {modal === 'borrow' && manager && market && (
        <BorrowRepayModal
          poolKey={poolKey}
          managerId={manager.id}
          poolLabel={market.market}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between text-[11px] py-1">
      <span style={{ color: textSecondary }}>{label}</span>
      <span className="font-mono font-semibold" style={{ color: valueColor ?? textPrimary }}>
        {value}
      </span>
    </div>
  );
}
