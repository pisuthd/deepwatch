'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useSpotPools, type SpotPool } from '../../../hooks/useSpotPools';
import { useCurrentPool, useSetCurrentPool } from './CurrentPoolContext';
import GlassCard from '../../common/GlassCard';
import SwapCard from './SwapCard';
import { getCoinIcon } from '../../../lib/coinIcons';
import { useNetwork } from '../../../context/NetworkContext';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

// Adaptive fraction digits so a 0.00243 rate and a 1234.5 rate both render
// readably (without either drowning in trailing zeros or losing precision).
function formatPrice(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n === 0) return '—';
  if (n >= 10000) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  if (n >= 1000) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (n >= 1) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }
  // Tiny prices (e.g. 0.00243): show 4–6 significant digits.
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

// Compact 24h-volume formatter: 1.2K / 3.4M / 1.5B.
function formatCompact(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n === 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

// 24h-volume display that drops the quote-asset suffix when the pair is
// USD-denominated (USDC, USDT, DBUSDC, ...). For a `SUI_USDC` pool the user
// reads "$1.4M" as USD volume; for a `SUI_DEEP` pool it stays "1.4M DEEP"
// because we don't have a USD reference for DEEP.
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
      <span
        className="text-[10px] uppercase tracking-wide"
        style={{ color: textSecondary }}
      >
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

export default function SpotSimpleMode() {
  const { pools, loading } = useSpotPools();
  const { poolKey: currentPoolKey, baseAsset, quoteAsset } = useCurrentPool();
  const setCurrentPool = useSetCurrentPool();
  const { network } = useNetwork();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  // Default-select a pool when nothing is chosen yet. Mainnet prefers
  // `XBTC_USDC` (the headline BTC pair); testnet falls back to whatever the
  // indexer returned first since the testnet default varies by season.
  useEffect(() => {
    if (!currentPoolKey && pools.length > 0) {
      const preferred = network === 'mainnet'
        ? pools.find((p) => p.poolName === 'XBTC_USDC') ?? pools[0]
        : pools[0];
      setCurrentPool({
        poolKey: preferred.poolName,
        baseAsset: preferred.baseAsset,
        quoteAsset: preferred.quoteAsset,
        baseAssetId: preferred.baseAssetId,
        quoteAssetId: preferred.quoteAssetId,
        baseAssetDecimals: preferred.baseAssetDecimals,
        quoteAssetDecimals: preferred.quoteAssetDecimals,
      });
    }
  }, [currentPoolKey, pools, setCurrentPool, network]);

  const currentPool: SpotPool | undefined = useMemo(
    () => pools.find((p) => p.poolName === currentPoolKey),
    [pools, currentPoolKey],
  );

  // Close the pair selector on outside click.
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
          Loading pools…
        </div>
      </div>
    );
  }

  if (pools.length === 0) {
    return (
      <div className="max-w-xl mx-auto">
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
    <div className="max-w-xl mx-auto space-y-3">
      {/* Pair header: overlapping icons + pair name + chevron selector + 24h change.
          `overflow="visible"` lets the pair-selector dropdown escape the card; the
          bumped z-index keeps it stacked above the swap card below. */}
      <GlassCard overflow="visible" className="z-30">
        {currentPool && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div ref={selectorRef} className="relative flex-1 min-w-0">
                <button
                  onClick={() => setSelectorOpen(!selectorOpen)}
                  className="flex items-center gap-2.5 w-full text-left rounded-lg -ml-1 pl-1 pr-2 py-1 hover:bg-white/5 transition-colors"
                >
                  {/* Overlapping coin icons (base behind, quote in front).
                      The ring matches the card bg so the overlap reads as one
                      unit instead of two stacked discs. */}
                  <div className="flex items-center -space-x-2.5 shrink-0">
                    <Image
                      src={getCoinIcon(currentPool.baseAsset)}
                      alt={currentPool.baseAsset}
                      width={30}
                      height={30}
                      className="rounded-full ring-2 ring-[#1A1D2E]"
                    />
                    <Image
                      src={getCoinIcon(currentPool.quoteAsset)}
                      alt={currentPool.quoteAsset}
                      width={30}
                      height={30}
                      className="rounded-full ring-2 ring-[#1A1D2E]"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span
                        className="text-base font-bold truncate"
                        style={{ color: textPrimary }}
                      >
                        {currentPool.baseAsset}
                      </span>
                      <span
                        className="text-base font-bold"
                        style={{ color: textSecondary }}
                      >
                        /
                      </span>
                      <span
                        className="text-base font-bold truncate"
                        style={{ color: textPrimary }}
                      >
                        {currentPool.quoteAsset}
                      </span>
                      <ChevronDown
                        size={14}
                        className={`shrink-0 transition-transform ${selectorOpen ? 'rotate-180' : ''
                          }`}
                        style={{ color: textSecondary }}
                      />
                    </div>
                    <div
                      className="text-[10px] uppercase tracking-wide truncate"
                      style={{ color: textSecondary }}
                    >
                      {currentPool.poolName}
                    </div>
                  </div>
                </button>

                {/* Pair selector dropdown */}
                {selectorOpen && (
                  <div
                    className="absolute top-full left-0 right-0 mt-2 py-1 rounded-xl z-50 overflow-hidden max-h-80 overflow-y-auto shadow-2xl"
                    style={{
                      background: 'rgba(22, 25, 34, 0.98)',
                      backdropFilter: 'blur(20px)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    {pools.map((p) => {

                      const isActive = p.poolName === currentPoolKey;
                      const change = p.change24h ?? 0;
                      return (
                        <button
                          key={p.poolName}
                          onClick={() => selectPool(p)}
                          className="w-full px-3 py-2.5 text-left transition-colors"
                          style={{
                            background: isActive
                              ? 'rgba(0, 230, 138, 0.12)'
                              : 'transparent',
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
                                src={getCoinIcon(p.baseAsset)}
                                alt={p.baseAsset}
                                width={20}
                                height={20}
                                className="rounded-full"
                              />
                              <Image
                                src={getCoinIcon(p.quoteAsset)}
                                alt={p.quoteAsset}
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
                                {p.baseAsset}/{p.quoteAsset}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div
                                className="text-xs font-mono font-semibold"
                                style={{ color: textPrimary }}
                              >
                                {formatPrice(p.lastPrice)}
                              </div>
                              <div
                                className="text-[10px] font-mono"
                                style={{ color: change >= 0 ? green : red }}
                              >
                                {change >= 0 ? '+' : ''}
                                {change.toFixed(2)}%
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Price row. The price on a DeepBook pool is a RELATIVE rate
                (base per quote), not a USD value — so no "$" prefix. The
                "per" suffix makes the unit explicit. */}
            <div className="mt-3 flex items-baseline gap-2 flex-wrap">
              <span
                className="text-2xl font-bold font-mono leading-none"
                style={{ color: textPrimary }}
              >
                {formatPrice(currentPool.lastPrice)}
              </span>
              <span
                className="text-xs leading-none"
                style={{ color: textSecondary }}
              >
                {currentPool.baseAsset} per {currentPool.quoteAsset}
              </span>
              {currentPool.change24h !== undefined && (
                <span
                  className="text-xs font-mono font-semibold ml-auto leading-none"
                  style={{ color: currentPool.change24h >= 0 ? green : red }}
                >
                  {currentPool.change24h >= 0 ? '+' : ''}
                  {currentPool.change24h.toFixed(2)}% · 24h
                </span>
              )}
            </div>

            {/* Stats grid. 24h high/low/vol give volatility & activity context;
                bid/ask shows the current best quote prices on each side. */}
            <div
              className="mt-3 grid grid-cols-4 gap-3 pt-3"
              style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
            >
              <Stat label="24h High" value={formatPrice(currentPool.highestPrice24h)} />
              <Stat label="24h Low" value={formatPrice(currentPool.lowestPrice24h)} />
              <Stat
                label="24h Vol"
                value={formatVolume(currentPool.quoteAsset, currentPool.quoteVolume)}
              />
              <Stat
                label="Bid / Ask"
                value={
                  currentPool.highestBid !== undefined &&
                    currentPool.lowestAsk !== undefined
                    ? `${formatPrice(currentPool.highestBid)} / ${formatPrice(currentPool.lowestAsk)}`
                    : '—'
                }
              />
            </div>
          </>
        )}
      </GlassCard>

      {/* Swap card */}
      {currentPoolKey && baseAsset && quoteAsset && (
        <GlassCard>
          <SwapCard poolKey={currentPoolKey} baseAsset={baseAsset} quoteAsset={quoteAsset} />
        </GlassCard>
      )}
    </div>
  );
}
