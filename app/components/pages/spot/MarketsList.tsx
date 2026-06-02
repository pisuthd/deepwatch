'use client';

import { useSpotPools, type SpotPool } from '../../../hooks/useSpotPools';
import { useSetCurrentPool } from './CurrentPoolContext';
import { getCoinIcon } from '../../../lib/coinIcons';
import GlassCard from '../../common/GlassCard';
import Image from 'next/image';

const cyan = '#3EC4C0';
const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

function formatPrice(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function formatVolume(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

interface MarketsListProps {
  pools: SpotPool[];
}

export default function MarketsList({ pools }: MarketsListProps) {
  const setCurrentPool = useSetCurrentPool();

  return (
    <div className="max-w-3xl mx-auto space-y-2">
      <GlassCard>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: textPrimary }}>
            Markets
          </h2>
          <span className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
            {pools.length} active
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {pools.map((p) => {
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
                className="text-left p-3 rounded-lg transition-all hover:scale-[1.01]"
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex items-center -space-x-1.5">
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
                  <span className="text-sm font-semibold" style={{ color: textPrimary }}>
                    {p.baseAsset}/{p.quoteAsset}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-base font-mono font-bold" style={{ color: textPrimary }}>
                    ${formatPrice(p.lastPrice)}
                  </span>
                  <span
                    className="text-xs font-mono font-semibold"
                    style={{ color: change >= 0 ? green : red }}
                  >
                    {change >= 0 ? '+' : ''}
                    {change.toFixed(2)}%
                  </span>
                </div>
                <div
                  className="flex items-center justify-between mt-1.5 text-[10px] uppercase tracking-wide"
                  style={{ color: textSecondary }}
                >
                  <span>Vol 24h</span>
                  <span className="font-mono normal-case tracking-normal" style={{ color: textPrimary }}>
                    {formatVolume(p.quoteVolume)} {p.quoteAsset}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
