'use client';

import { useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useSpotPools, type SpotPool } from '../../../hooks/useSpotPools';
import { useCurrentPool, useSetCurrentPool } from './CurrentPoolContext';
import GlassCard from '../../common/GlassCard';
import SwapCard from './SwapCard';

const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

function formatPrice(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

export default function SpotSimpleMode() {
  const { pools, loading } = useSpotPools();
  const { poolKey: currentPoolKey, baseAsset, quoteAsset } = useCurrentPool();
  const setCurrentPool = useSetCurrentPool();

  // Default-select the first active pool when nothing is chosen
  useEffect(() => {
    if (!currentPoolKey && pools.length > 0) {
      const p = pools[0];
      setCurrentPool({
        poolKey: p.poolName,
        baseAsset: p.baseAsset,
        quoteAsset: p.quoteAsset,
        baseAssetId: p.baseAssetId,
        quoteAssetId: p.quoteAssetId,
        baseAssetDecimals: p.baseAssetDecimals,
        quoteAssetDecimals: p.quoteAssetDecimals,
      });
    }
  }, [currentPoolKey, pools, setCurrentPool]);

  const currentPool: SpotPool | undefined = useMemo(
    () => pools.find((p) => p.poolName === currentPoolKey),
    [pools, currentPoolKey],
  );

  if (loading && pools.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-sm" style={{ color: textSecondary }}>
          <Loader2 size={20} className="animate-spin" style={{ color: cyan }} />
          Loading pools…
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
    <div className="max-w-md mx-auto space-y-3">
      {/* Pair selector header */}
      <GlassCard>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {pools.map((p) => {
            const isActive = p.poolName === currentPoolKey;
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
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                style={{
                  background: isActive
                    ? 'rgba(62, 196, 192, 0.15)'
                    : 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${
                    isActive ? 'rgba(62, 196, 192, 0.4)' : 'rgba(255, 255, 255, 0.08)'
                  }`,
                  color: isActive ? cyan : textSecondary,
                }}
              >
                {p.baseAsset}/{p.quoteAsset}
              </button>
            );
          })}
        </div>
        {currentPool && (
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono" style={{ color: textPrimary }}>
              ${formatPrice(currentPool.lastPrice)}
            </span>
            {currentPool.change24h !== undefined && (
              <span
                className="text-xs font-mono"
                style={{ color: currentPool.change24h >= 0 ? '#00E68A' : '#ef4444' }}
              >
                {currentPool.change24h >= 0 ? '+' : ''}
                {currentPool.change24h.toFixed(2)}%
              </span>
            )}
          </div>
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
