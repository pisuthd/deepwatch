'use client';

import { useCallback, useState } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useDAppKit } from '@mysten/dapp-kit-react';
import { useSpotPools } from '../../../hooks/useSpotPools';
import { useDeepbook, type OpenOrder } from '../../../hooks/useDeepbook';
import { useCurrentPool, useSetCurrentPool } from './CurrentPoolContext';
import MarketsList from './MarketsList';
import CandlestickChart from './CandlestickChart';
import OrderBookView from './OrderBook';
import TradePanel from './TradePanel';
import GlassCard from '../../common/GlassCard';

const cyan = '#3EC4C0';
const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

const EMPTY_POOL = {
  poolKey: null,
  baseAsset: null,
  quoteAsset: null,
  baseAssetId: null,
  quoteAssetId: null,
  baseAssetDecimals: null,
  quoteAssetDecimals: null,
} as const;

export default function SpotAdvancedMode() {
  const { pools, loading, getOHLCV } = useSpotPools();
  const { openOrders, cancelOrder } = useDeepbook();
  const dAppKit = useDAppKit();
  const { poolKey, baseAsset, quoteAsset } = useCurrentPool();
  const setCurrentPool = useSetCurrentPool();
  const [interval, setInterval] = useState<Interval>('15m');

  // When a pool is selected, fetch candles via getOHLCV. Memoized so the
  // CandlestickChart effect doesn't refire unnecessarily.
  const fetchCandles = useCallback(
    async (iv: string) => {
      if (!poolKey) return [];
      return getOHLCV(poolKey, iv, 200);
    },
    [poolKey, getOHLCV],
  );

  const handleCancel = async (o: OpenOrder) => {
    if (!dAppKit?.signAndExecuteTransaction) return;
    try {
      await cancelOrder(dAppKit.signAndExecuteTransaction, o.poolKey, o.orderId);
    } catch (e) {
      console.error('Cancel failed', e);
    }
  };

  // No pool selected → markets list
  if (!poolKey || !baseAsset || !quoteAsset) {
    if (loading && pools.length === 0) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-sm" style={{ color: textSecondary }}>
            <Loader2 size={20} className="animate-spin" style={{ color: cyan }} />
            Loading markets…
          </div>
        </div>
      );
    }
    return <MarketsList pools={pools} />;
  }

  // Pool selected → 4-pane layout
  const poolOrders: OpenOrder[] = openOrders.filter((o) => o.poolKey === poolKey);

  return (
    <div className="space-y-3">
      {/* Top bar: back + pair info + interval selector */}
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
        <button
          onClick={() => setCurrentPool(EMPTY_POOL)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors hover:bg-white/5"
          style={{ color: textSecondary }}
        >
          <ChevronLeft size={14} />
          Markets
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: textPrimary }}>
            {baseAsset}/{quoteAsset}
          </span>
          <div className="flex items-center gap-1">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors"
                style={{
                  background:
                    iv === interval ? 'rgba(62,196,192,0.15)' : 'rgba(255,255,255,0.04)',
                  color: iv === interval ? cyan : textSecondary,
                }}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Chart (spans 2 cols) */}
        <div className="md:col-span-2 min-h-[320px]">
          <GlassCard className="h-full">
            <CandlestickChart fetchCandles={fetchCandles} interval={interval} />
          </GlassCard>
        </div>

        {/* Order book */}
        <div className="min-h-[320px]">
          <GlassCard className="h-full">
            <OrderBookView poolName={poolKey} />
          </GlassCard>
        </div>
      </div>

      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Trade panel */}
        <div>
          <GlassCard>
            <TradePanel
              poolKey={poolKey}
              baseAsset={baseAsset}
              quoteAsset={quoteAsset}
            />
          </GlassCard>
        </div>

        {/* Open orders for this pool */}
        <div className="md:col-span-2">
          <GlassCard>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold" style={{ color: textPrimary }}>
                Open Orders
              </h3>
              <span className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
                {poolOrders.length} for {poolKey}
              </span>
            </div>
            {poolOrders.length === 0 ? (
              <div className="text-center text-xs py-6" style={{ color: textSecondary }}>
                No open orders for this pool.
              </div>
            ) : (
              <div className="space-y-1">
                {poolOrders.map((o) => {
                  const color = o.isBid ? green : red;
                  return (
                    <div
                      key={`${o.poolKey}|${o.orderId}`}
                      className="flex items-center justify-between px-2 py-1.5 rounded text-[11px]"
                      style={{ background: 'rgba(255,255,255,0.03)' }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-semibold" style={{ color }}>
                          {o.isBid ? 'BUY' : 'SELL'}
                        </span>
                        <span className="font-mono" style={{ color: textPrimary }}>
                          {o.quantity} @ {o.price}
                        </span>
                        <span className="font-mono" style={{ color: textSecondary }}>
                          filled {o.filledQuantity}
                        </span>
                      </div>
                      <button
                        onClick={() => handleCancel(o)}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded transition-colors hover:bg-white/10"
                        style={{ color: cyan }}
                      >
                        CANCEL
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
