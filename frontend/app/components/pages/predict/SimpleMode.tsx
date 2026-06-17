'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMarkets } from '../../../hooks/useMarkets';
import { useMarket } from '../../../hooks/useMarket';
import { calculateStrikeProbabilities } from '../../../hooks/useSVI';
import { getCoinIcon } from '../../../lib/coinIcons';
import Countdown from '../../common/Countdown';
import GlassCard from '../../common/GlassCard';
import BinaryTradeModal from './BinaryTradeModal';
import RangeTradeModal from './RangeTradeModal';
import { useSetCurrentMarket } from './CurrentMarketContext';
import {
  DISPLAY_TICK_USD,
  formatExpiryDate,
  formatPrice,
  generateStrikes,
  roundToTick,
  SIMPLE_RANGE_WIDTHS_USD,
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

  // Range mode — local to Simple. The 5-strike ladder acts as the
  // trigger picker; one of three preset widths (SIMPLE_RANGE_WIDTHS_USD)
  // sets the band. Center strike is the default trigger on market change.
  const [marketType, setMarketType] = useState<'binary' | 'range'>('binary');
  const [triggerIdx, setTriggerIdx] = useState(0);
  const [chosenWidth, setChosenWidth] = useState<number>(1000);
  const [rangeModalOpen, setRangeModalOpen] = useState(false);

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

  // Reset triggerIdx to center when the market switches, so the page
  // always opens with a sensible band around the current oracle's spot.
  const lastOracleIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = currentMarket?.oracle_id ?? null;
    if (id === null) {
      lastOracleIdRef.current = null;
      setTriggerIdx(0);
      return;
    }
    if (lastOracleIdRef.current !== id) {
      lastOracleIdRef.current = id;
      setTriggerIdx(2); // 5-strike ladder: indices 0..4, center = 2
    }
  }, [currentMarket?.oracle_id]);
  const { market: marketDetail, loading: marketLoading } = useMarket(
    currentOracleId,
    30_000
  );

  // Publish current market to the popover/page context
  const setCurrentMarket = useSetCurrentMarket();
  useEffect(() => {
    setCurrentMarket({
      oracleId: currentMarket?.oracle_id ?? null,
      asset: currentMarket?.asset ?? null,
    });
  }, [currentMarket?.oracle_id, currentMarket?.asset, setCurrentMarket]);

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
                  <Countdown expiryMs={expiryMs} />
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

        {/* Binary / Range segmented toggle */}
        <div
          className="inline-flex items-center rounded-lg p-0.5 gap-0.5 mx-auto"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {(['binary', 'range'] as const).map((id) => {
            const isActive = marketType === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMarketType(id)}
                className="px-4 py-1.5 rounded-md text-xs font-semibold transition-colors"
                style={{
                  background: isActive ? green : 'transparent',
                  color: isActive ? '#000' : textSecondary,
                }}
              >
                {id === 'binary' ? 'Binary' : 'Range'}
              </button>
            );
          })}
        </div>

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
              const isTrigger = i === triggerIdx;
              // Range mode: row is a tap target (selects trigger).
              // Binary mode: row is informational; UP/DOWN buttons inside drive.
              return (
                <div
                  key={strikes[i]}
                  onClick={() => {
                    if (marketType === 'range') setTriggerIdx(i);
                  }}
                  className="w-full flex items-center justify-between rounded-xl px-3 py-2 mb-1 transition-all"
                  style={{
                    background:
                      marketType === 'binary'
                        ? isCenter
                          ? 'rgba(0, 230, 138, 0.06)'
                          : 'transparent'
                        : isTrigger
                          ? 'rgba(0, 230, 138, 0.10)'
                          : 'transparent',
                    cursor: marketType === 'range' ? 'pointer' : 'default',
                  }}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-base font-semibold"
                      style={{ color: marketType === 'range' && isTrigger ? green : isCenter ? green : textPrimary }}
                    >
                      {formatPrice(strikes[i])}
                    </span>
                    {marketType === 'binary' && isCenter && (
                      <span className="text-[10px]" style={{ color: textSecondary }}>
                        ATM
                      </span>
                    )}
                    {marketType === 'range' && isTrigger && (
                      <span className="text-[10px]" style={{ color: green }}>
                        Trigger
                      </span>
                    )}
                  </div>
                  {marketType === 'binary' && (
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
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Range mode: 3 preset widths + Place Range Bet button */}
        {marketType === 'range' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {SIMPLE_RANGE_WIDTHS_USD.map((w) => {
                const isActive = chosenWidth === w;
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setChosenWidth(w)}
                    className="rounded-xl py-2.5 text-xs font-semibold transition-all"
                    style={{
                      background: isActive ? 'rgba(0, 230, 138, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                      border: `1px solid ${isActive ? 'rgba(0, 230, 138, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                      color: isActive ? green : textSecondary,
                    }}
                  >
                    ±${w.toLocaleString('en-US')}
                  </button>
                );
              })}
            </div>
            {(() => {
              const t = strikes[triggerIdx] ?? centerStrike;
              const lo = t - chosenWidth;
              const hi = t + chosenWidth;
              const canPlace = t > 0 && lo > 0;
              return (
                <button
                  type="button"
                  onClick={() => setRangeModalOpen(true)}
                  disabled={!canPlace}
                  className="w-full py-3 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: canPlace ? green : 'rgba(255, 255, 255, 0.08)',
                    color: canPlace ? '#000' : textSecondary,
                    cursor: canPlace ? 'pointer' : 'not-allowed',
                  }}
                >
                  ⇋ Place Range Bet · {formatPrice(lo)}–{formatPrice(hi)}
                </button>
              );
            })()}
          </div>
        )}

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

      {currentMarket && marketType === 'binary' && (
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

      {currentMarket && marketType === 'range' && (() => {
        const t = strikes[triggerIdx] ?? centerStrike;
        const lo = t - chosenWidth;
        const hi = t + chosenWidth;
        if (t <= 0 || lo <= 0) return null;
        return (
          <RangeTradeModal
            open={rangeModalOpen}
            onClose={() => setRangeModalOpen(false)}
            market={{
              oracleId: currentMarket.oracle_id,
              asset,
              expiryMs,
              spotUsd,
            }}
            lower={lo}
            upper={hi}
            triggerStrike={t}
            widthUsd={chosenWidth}
          />
        );
      })()}
    </div>
  );
}
