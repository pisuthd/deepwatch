'use client';

import { type SpotPool } from '../../../hooks/useSpotPools';
import { useSetCurrentPool } from './CurrentPoolContext';
import { getCoinIcon } from '../../../lib/coinIcons';
import GlassCard from '../../common/GlassCard';
import Image from 'next/image';

const cyan = '#3EC4C0';
const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

// Adaptive fraction digits so a 0.00243 rate and a 1234.5 rate both render
// readably. Mirrors `formatPrice` in `SimpleMode.tsx` so the markets strip
// and the simple-mode header stay in lock-step on tiny-price pools.
function formatPrice(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n === 0) return '—';
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
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function formatCompact(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n === 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

// USD-quote pools render as `$1.4M` (the volume IS in USD, so showing the
// quote asset would be redundant); non-USD pools keep the `<num> <ASSET>`
// format so the unit stays explicit.
function formatVolume(quoteAsset: string, volume: number | undefined): string {
  if (volume === undefined || volume === null || !Number.isFinite(volume) || volume === 0) return '—';
  const isUsdQuote = quoteAsset.toUpperCase().includes('USD');
  return isUsdQuote ? `$${formatCompact(volume)}` : `${formatCompact(volume)} ${quoteAsset}`;
}

interface MarketsListProps {
  pools: SpotPool[];
  /** Currently selected pool key, used to highlight the active card. */
  activePoolKey?: string | null;
}

export default function MarketsList({ pools, activePoolKey }: MarketsListProps) {
  const setCurrentPool = useSetCurrentPool();

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <h2
          className="text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: textSecondary }}
        >
          Markets
        </h2>
        <span
          className="text-[10px] uppercase tracking-wide"
          style={{ color: textSecondary }}
        >
          {pools.length} active · scroll →
        </span>
      </div>
      {/* Horizontal scroll strip. `min-w-max` on the inner flex line forces
          the row to overflow instead of wrapping, so the scrollbar appears
          once the column of cards exceeds the card width. */}
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div className="flex gap-2 min-w-max">
          {pools.map((p) => {
            const isActive = p.poolName === activePoolKey;
            const change = p.change24h ?? 0;
            return (
              <button
                key={p.poolName}
                onClick={() =>
                  setCurrentPool({
                    poolKey: p.poolName,
                    baseAsset: p.baseAsset,
                    quoteAsset: p.quoteAsset,
                    baseAssetId: p.baseAssetId,
                    quoteAssetId: p.quoteAssetId,
                    baseAssetDecimals: p.baseAssetDecimals,
                    quoteAssetDecimals: p.quoteAssetDecimals,
                  })
                }
                className="flex-shrink-0 w-44 p-2.5 rounded-lg text-left transition-colors"
                style={{
                  background: isActive
                    ? 'rgba(62, 196, 192, 0.10)'
                    : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${
                    isActive ? 'rgba(62, 196, 192, 0.40)' : 'rgba(255, 255, 255, 0.06)'
                  }`,
                }}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="flex items-center -space-x-1.5 shrink-0">
                    <Image
                      src={getCoinIcon(p.baseAsset)}
                      alt={p.baseAsset}
                      width={16}
                      height={16}
                      className="rounded-full"
                    />
                    <Image
                      src={getCoinIcon(p.quoteAsset)}
                      alt={p.quoteAsset}
                      width={16}
                      height={16}
                      className="rounded-full"
                    />
                  </div>
                  <span
                    className="text-xs font-bold truncate"
                    style={{ color: textPrimary }}
                  >
                    {p.baseAsset}/{p.quoteAsset}
                  </span>
                </div>
                <div
                  className="text-sm font-mono font-semibold leading-none"
                  style={{ color: textPrimary }}
                >
                  {formatPrice(p.lastPrice)}
                </div>
                <div
                  className="flex items-center justify-between mt-1.5 text-[10px]"
                >
                  <span
                    className="font-mono font-semibold"
                    style={{ color: change >= 0 ? green : red }}
                  >
                    {change >= 0 ? '+' : ''}
                    {change.toFixed(2)}%
                  </span>
                  <span style={{ color: textSecondary }}>24h</span>
                </div>
                <div
                  className="text-[10px] mt-1 truncate"
                  style={{ color: textSecondary }}
                >
                  Vol {formatVolume(p.quoteAsset, p.quoteVolume)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </GlassCard>
  );
}
