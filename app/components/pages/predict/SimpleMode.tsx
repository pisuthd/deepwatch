'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMarkets } from '../../../hooks/useMarkets';
import { useMarket } from '../../../hooks/useMarket';
import { calculateStrikeProbabilities } from '../../../hooks/useSVI';
import { getCoinIcon } from '../../../lib/coinIcons';
import GlassCard from '../../common/GlassCard';
import BinaryTradeModal from './BinaryTradeModal';
import {
  DISPLAY_TICK_USD,
  formatDetailedExpiry,
  formatExpiryDate,
  formatPrice,
  generateStrikes,
  roundToTick,
} from './utils';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

export default function PredictSimpleMode() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [modal, setModal] = useState<{
    open: boolean;
    strike: number;
    direction: 'up' | 'down';
  }>({ open: false, strike: 0, direction: 'up' });
  const [now, setNow] = useState(() => Date.now());

  // Live markets list
  const { markets, loading: marketsLoading } = useMarkets(30_000);
  const activeMarkets = useMemo(
    () => (markets ?? []).filter((m) => m.status === 'active'),
    [markets]
  );

  // Clamp selectedIdx when list shrinks
  useEffect(() => {
    if (activeMarkets.length === 0) {
      setSelectedIdx(0);
    } else if (selectedIdx >= activeMarkets.length) {
      setSelectedIdx(0);
    }
  }, [activeMarkets.length, selectedIdx]);

  const currentMarket = activeMarkets[selectedIdx] ?? null;
  const currentOracleId = currentMarket?.oracle_id ?? null;
  const { market: marketDetail, loading: marketLoading } = useMarket(
    currentOracleId,
    30_000
  );

  // 1s ticker for countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Derived values
  const spotUsd = marketDetail ? marketDetail.spot / 1e9 : 0;
  const expiryMs =
    marketDetail?.expiryMs ?? currentMarket?.expiryMs ?? 0;
  const svi = marketDetail?.svi ?? null;
  const asset = currentMarket?.asset ?? 'BTC';

  const strikes = useMemo(
    () => (spotUsd > 0 ? generateStrikes(spotUsd, 5, DISPLAY_TICK_USD) : []),
    [spotUsd]
  );
  const centerStrike = spotUsd > 0 ? roundToTick(spotUsd, DISPLAY_TICK_USD) : 0;

  // Forward must be passed in RAW (scaled by 1e9) per useSVI contract
  const probs = useMemo(() => {
    if (!marketDetail || !spotUsd) return [];
    return calculateStrikeProbabilities(
      strikes,
      marketDetail.forward,
      expiryMs,
      svi ?? undefined
    );
  }, [marketDetail, strikes, expiryMs, svi, spotUsd]);

  const go = (delta: number) => {
    if (activeMarkets.length < 2) return;
    setSelectedIdx((i) => (i + delta + activeMarkets.length) % activeMarkets.length);
  };

  // ─── Render branches ────────────────────────────────────────────────────

  if (marketsLoading && activeMarkets.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-sm" style={{ color: textSecondary }}>
          <Loader2 size={20} className="animate-spin" style={{ color: green }} />
          Loading markets…
        </div>
      </div>
    );
  }

  if (!currentMarket) {
    return (
      <div className="max-w-md mx-auto">
        <GlassCard>
          <div className="text-center py-8">
            <h2 className="text-lg font-bold mb-2" style={{ color: textPrimary }}>
              No active markets
            </h2>
            <p className="text-sm" style={{ color: textSecondary }}>
              Check back later — new markets open regularly.
            </p>
          </div>
        </GlassCard>
      </div>
    );
  }

  const showSkeleton = marketLoading && !marketDetail;
  const question = `Will ${asset} be above or below ${formatPrice(centerStrike)}?`;

  return (
    <div className="flex items-center justify-center gap-4">
      <button
        onClick={() => go(-1)}
        disabled={activeMarkets.length < 2}
        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ background: 'rgba(40, 44, 60, 0.5)' }}
        aria-label="Previous market"
      >
        <ChevronLeft size={18} style={{ color: textSecondary }} />
      </button>

      <div className="w-full max-w-md space-y-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentMarket.oracle_id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            <GlassCard>
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Image
                    src={getCoinIcon(asset)}
                    alt={asset}
                    width={20}
                    height={20}
                    className="rounded-full shrink-0"
                  />
                  <span className="text-sm font-semibold" style={{ color: textPrimary }}>
                    {asset}
                  </span>
                  <span className="text-xs" style={{ color: textSecondary }}>
                    /USD
                  </span>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded shrink-0 font-mono"
                  style={{ background: 'rgba(40, 44, 60, 0.5)', color: textSecondary }}
                >
                  {formatDetailedExpiry(expiryMs, now)}
                </span>
              </div>

              <h2 className="text-base font-bold mb-3 leading-snug" style={{ color: textPrimary }}>
                {showSkeleton ? '…' : question}
              </h2>

              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: textSecondary }}>
                    Spot
                  </div>
                  <div className="text-2xl font-bold" style={{ color: green }}>
                    {showSkeleton ? '—' : formatPrice(spotUsd)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: textSecondary }}>
                    Expires
                  </div>
                  <div className="text-xs font-mono" style={{ color: textSecondary }}>
                    {showSkeleton ? '—' : formatExpiryDate(expiryMs)}
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </AnimatePresence>

        <div className="max-h-[450px] overflow-y-auto pr-1">
          {probs.length === 0 ? (
            <div
              className="text-center text-xs py-8"
              style={{ color: textSecondary }}
            >
              {marketLoading ? 'Loading odds…' : 'Awaiting oracle data…'}
            </div>
          ) : (
            probs.map((p, i) => {
              const isCenter = strikes[i] === centerStrike;
              return (
                <div
                  key={strikes[i]}
                  className="w-full flex items-center justify-between rounded-xl px-3 py-2 mb-1 transition-all"
                  style={{
                    background: isCenter ? 'rgba(0, 230, 138, 0.06)' : 'transparent',
                  }}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-base font-semibold"
                      style={{ color: isCenter ? green : textPrimary }}
                    >
                      {formatPrice(strikes[i])}
                    </span>
                    {isCenter && (
                      <span className="text-[10px]" style={{ color: textSecondary }}>
                        ATM
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({ open: true, strike: strikes[i], direction: 'up' });
                      }}
                      className="relative rounded-2xl px-4 py-2.5 overflow-hidden border border-white/10"
                      style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
                    >
                      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent" />
                      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                      <div
                        className="absolute -top-4 -right-4 w-12 h-12 rounded-full"
                        style={{ background: green, filter: 'blur(30px)', opacity: 0.15 }}
                      />
                      <span
                        className="relative z-10 text-sm font-semibold"
                        style={{ color: green }}
                      >
                        ▲ UP {(p.upProb / 100).toFixed(2)}
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({ open: true, strike: strikes[i], direction: 'down' });
                      }}
                      className="relative rounded-2xl px-4 py-2.5 overflow-hidden border border-white/10"
                      style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
                    >
                      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent" />
                      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                      <div
                        className="absolute -top-4 -right-4 w-12 h-12 rounded-full"
                        style={{ background: red, filter: 'blur(30px)', opacity: 0.15 }}
                      />
                      <span
                        className="relative z-10 text-sm font-semibold"
                        style={{ color: red }}
                      >
                        ▼ DOWN {(p.downProb / 100).toFixed(2)}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="text-center text-xs" style={{ color: textSecondary }}>
          {selectedIdx + 1} / {activeMarkets.length}
        </div>
      </div>

      <button
        onClick={() => go(1)}
        disabled={activeMarkets.length < 2}
        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-30 disabled:cursor-not-allowed"
        style={{ background: 'rgba(40, 44, 60, 0.5)' }}
        aria-label="Next market"
      >
        <ChevronRight size={18} style={{ color: textSecondary }} />
      </button>

      {currentMarket && (
        <BinaryTradeModal
          open={modal.open}
          onClose={() => setModal((m) => ({ ...m, open: false }))}
          market={{
            oracleId: currentMarket.oracle_id,
            asset,
            expiryMs,
            spotUsd,
          }}
          strike={modal.strike}
          initialDirection={modal.direction}
        />
      )}
    </div>
  );
}
