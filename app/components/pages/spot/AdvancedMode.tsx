'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { useSpotPools, type SpotPool } from '../../../hooks/useSpotPools';
import { useCurrentPool, useSetCurrentPool } from './CurrentPoolContext';
import CandlestickChart from './CandlestickChart';
import OrderBookView from './OrderBook';
import TradePanel from './TradePanel';
import GlassCard from '../../common/GlassCard';
import { getCoinIcon } from '../../../lib/coinIcons';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

type TradingTab = 'orderbook' | 'trade';

// Adaptive price formatter (mirrors `SimpleMode.formatPrice`).
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
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
        {label}
      </span>
      <span className="text-sm font-mono font-semibold truncate" style={{ color: valueColor ?? textPrimary }}>
        {value}
      </span>
    </div>
  );
}

/**
 * Underline-style tab button with animated underline indicator.
 * Uses framer-motion layoutId for smooth sliding animation.
 */
function UnderlineTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative pb-3 px-3 text-sm font-medium transition-colors duration-200 ${
        active ? 'text-white' : 'text-gray-500 hover:text-gray-300'
      }`}
    >
      {children}
      {active && (
        <motion.div
          layoutId="spotActiveTab"
          className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-primary"
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        />
      )}
    </button>
  );
}

export default function SpotAdvancedMode() {
  const { pools, loading, getOHLCV } = useSpotPools();
  const { poolKey, baseAsset, quoteAsset } = useCurrentPool();
  const setCurrentPool = useSetCurrentPool();
  const [interval, setInterval] = useState<Interval>('4h');
  const [tab, setTab] = useState<TradingTab>('orderbook');
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  // Active pool record (looked up by key) — used for the info bar stats.
  const currentPool = useMemo(
    () => (poolKey ? pools.find((p) => p.poolName === poolKey) : undefined),
    [pools, poolKey],
  );

  // Fetch candles for the active pool. Memoized so the CandlestickChart's
  // effect doesn't refire on unrelated re-renders.
  const fetchCandles = useCallback(
    async (iv: string) => {
      if (!poolKey) return [];
      return getOHLCV(poolKey, iv, 200);
    },
    [poolKey, getOHLCV],
  );

  // Close the pair dropdown on outside click.
  useEffect(() => {
    if (!selectorOpen) return;
    const handler = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectorOpen]);

  const selectPool = (p: SpotPool) => {
    setCurrentPool({
      poolKey: p.poolName,
      baseAsset: p.baseAsset,
      quoteAsset: p.quoteAsset,
      baseAssetId: p.baseAssetId,
      quoteAssetId: p.quoteAssetId,
      baseAssetDecimals: p.baseAssetDecimals,
      quoteAssetDecimals: p.quoteAssetDecimals,
    });
    setSelectorOpen(false);
  };

  if (loading && pools.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-sm" style={{ color: textSecondary }}>
          <Loader2 size={24} className="animate-spin" style={{ color: green }} />
          Loading markets…
        </div>
      </div>
    );
  }

  if (pools.length === 0) {
    return (
      <div className="max-w-md mx-auto">
        <GlassCard>
          <div className="text-center py-8">
            <h2 className="text-lg font-bold mb-2" style={{ color: textPrimary }}>
              No active pools
            </h2>
            <p className="text-sm" style={{ color: textSecondary }}>
              The indexer is reporting no active pools on the current network.
            </p>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-7 gap-4 mx-auto"> 
      <GlassCard overflow="visible" className="col-span-5 relative z-20">
        {currentPool && baseAsset && quoteAsset ? (
          <>
            {/* Row 1: Pair selector (compact) + Price + 24h change */}
            <div className="flex items-center gap-6">
              {/* Compact pair selector */}
              <div ref={selectorRef} className="relative shrink-0 w-[200px]">
                <button
                  onClick={() => setSelectorOpen(!selectorOpen)}
                  className="flex items-center gap-2 w-full text-left rounded-lg hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center -space-x-2 shrink-0">
                    <Image
                      src={getCoinIcon(currentPool.baseAsset)}
                      alt={currentPool.baseAsset}
                      width={26}
                      height={26}
                      className="rounded-full ring-2 ring-[#1A1D2E]"
                    />
                    <Image
                      src={getCoinIcon(currentPool.quoteAsset)}
                      alt={currentPool.quoteAsset}
                      width={26}
                      height={26}
                      className="rounded-full ring-2 ring-[#1A1D2E]"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-bold truncate" style={{ color: textPrimary }}>
                        {currentPool.baseAsset}
                      </span>
                      <span className="text-sm font-bold" style={{ color: textSecondary }}>/</span>
                      <span className="text-sm font-bold truncate" style={{ color: textPrimary }}>
                        {currentPool.quoteAsset}
                      </span>
                      <ChevronDown size={12} className={`shrink-0 transition-transform ${selectorOpen ? 'rotate-180' : ''}`} style={{ color: textSecondary }} />
                    </div>
                  </div>
                </button>

                {selectorOpen && (
                  <div className="absolute top-full left-0 mt-2 w-56 py-1 rounded-xl z-50 overflow-hidden max-h-80 overflow-y-auto shadow-2xl" style={{ background: 'rgba(22, 25, 34, 0.98)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                    {pools.map((p) => {
                      const isActive = p.poolName === poolKey;
                      const change = p.change24h ?? 0;
                      return (
                        <button key={p.poolName} onClick={() => selectPool(p)} className="w-full px-3 py-2 text-left transition-colors" style={{ background: isActive ? 'rgba(0, 230, 138, 0.12)' : 'transparent' }} onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.04)'; }} onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center -space-x-1.5 shrink-0">
                              <Image src={getCoinIcon(p.baseAsset)} alt={p.baseAsset} width={18} height={18} className="rounded-full" />
                              <Image src={getCoinIcon(p.quoteAsset)} alt={p.quoteAsset} width={18} height={18} className="rounded-full" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold truncate" style={{ color: textPrimary }}>{p.baseAsset}/{p.quoteAsset}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-xs font-mono font-semibold" style={{ color: textPrimary }}>{formatPrice(p.lastPrice)}</div>
                              <div className="text-[10px] font-mono" style={{ color: change >= 0 ? green : red }}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Price with unit suffix */}
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono leading-none" style={{ color: textPrimary }}>
                  {formatPrice(currentPool.lastPrice)}
                </span>
                <span className="text-xs leading-none" style={{ color: textSecondary }}>
                  {baseAsset} per {quoteAsset}
                </span>
              </div>
              {/* 24h Change */}
              {currentPool.change24h !== undefined && (
                <span className="text-xs font-mono font-semibold ml-auto leading-none" style={{ color: currentPool.change24h >= 0 ? green : red }}>
                  {currentPool.change24h >= 0 ? '+' : ''}{currentPool.change24h.toFixed(2)}% · 24h
                </span>
              )}
            </div>

            {/* Row 2: 24h stats inline */}
            <div className="flex items-center gap-6 mt-3">
              <Stat label="High" value={formatPrice(currentPool.highestPrice24h)} />
              <Stat label="Low" value={formatPrice(currentPool.lowestPrice24h)} />
              <Stat label="Vol" value={formatVolume(currentPool.quoteAsset, currentPool.quoteVolume)} />
              {currentPool.highestBid !== undefined && currentPool.lowestAsk !== undefined && (
                <Stat label="Bid/Ask" value={`${formatPrice(currentPool.highestBid)} / ${formatPrice(currentPool.lowestAsk)}`} />
              )}
            </div>

            {/* Chart with interval selector — fixed 400px height so the
                chart always renders the same vertical real estate regardless
                of the active tab in card 2. */}
            <div className="mt-4">
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
                      onClick={() => setInterval(iv)}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors"
                      style={{
                        background:
                          iv === interval ? 'rgba(0,230,138,0.15)' : 'rgba(255,255,255,0.04)',
                        color: iv === interval ? green : textSecondary,
                        border: `1px solid ${
                          iv === interval ? 'rgba(0,230,138,0.35)' : 'rgba(255,255,255,0.06)'
                        }`,
                      }}
                    >
                      {iv}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-[400px]">
                <CandlestickChart fetchCandles={fetchCandles} interval={interval} />
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <p className="text-sm" style={{ color: textSecondary }}>
              Select a market to start trading.
            </p>
          </div>
        )}
      </GlassCard>

      {/* ── Card 2: Order Book / Trade (underline tabs) ────────────────── */}
      {currentPool && baseAsset && quoteAsset && poolKey && (
        <GlassCard className="flex flex-col col-span-2 overflow-hidden">
          <div className="flex shrink-0 ">
            <UnderlineTab
              active={tab === 'orderbook'}
              onClick={() => setTab('orderbook')}
            >
              Order Book
            </UnderlineTab>
            <UnderlineTab
              active={tab === 'trade'}
              onClick={() => setTab('trade')}
            >
              Trade
            </UnderlineTab>
          </div>

          <div className="pt-4 flex-1 overflow-y-auto min-h-0">
            {tab === 'orderbook' ? (
              <OrderBookView poolName={poolKey} />
            ) : (
              <TradePanel
                poolKey={poolKey}
                baseAsset={baseAsset}
                quoteAsset={quoteAsset}
              />
            )}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
