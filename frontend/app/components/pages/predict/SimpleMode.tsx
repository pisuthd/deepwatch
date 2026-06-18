'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Loader2, Goal } from 'lucide-react';
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
  assetFullName,
  formatExpiryDayTime,
  formatPrice,
  generateStrikes,
  roundToTick,
  SIMPLE_RANGE_WIDTHS_USD,
} from './utils';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

// Drop range bands whose inside-probability is at or below 2% / at or
// above 98% — they are visually indistinguishable from 0/1 and not
// tradeable. Strict bounds so 0.02 and 0.98 themselves are also dropped.
const RANGE_MIN_PROB = 0.02;
const RANGE_MAX_PROB = 0.98;

export default function PredictSimpleMode() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [modal, setModal] = useState<{
    open: boolean;
    strike: number;
    direction: 'up' | 'down';
  }>({ open: false, strike: 0, direction: 'up' });

  // Range mode — local to Simple. Range rows are always centered on the
  // spot (no trigger picker); picking a band opens RangeTradeModal with
  // those bounds. Binary keeps the existing UP/DOWN ladder.
  const [marketType, setMarketType] = useState<'binary' | 'range'>('binary');
  const [rangeModal, setRangeModal] = useState<{
    open: boolean;
    lower: number;
    upper: number;
    widthUsd: number;
  }>({ open: false, lower: 0, upper: 0, widthUsd: 0 });
  const [leveragedOpen, setLeveragedOpen] = useState(false);

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

  // Range-mode odds: compute the implied probability that the final price
  // lands INSIDE each preset band. We reuse the same SVI distribution as
  // the binary ladder — insideProb(lo, hi) = downProb(hi) - downProb(lo).
  // Returns the band widths with their inside probabilities (0–1).
  const rangeOdds = useMemo(() => {
    if (!marketDetail || !centerStrike) {
      return SIMPLE_RANGE_WIDTHS_USD.map((w) => ({ width: w, insideProb: 0 }));
    }
    // 2 strikes per band (lo, hi). Guard lo > 0 to keep SVI happy.
    const boundaryStrikes: number[] = [];
    SIMPLE_RANGE_WIDTHS_USD.forEach((w) => {
      boundaryStrikes.push(Math.max(1, centerStrike - w));
      boundaryStrikes.push(centerStrike + w);
    });
    const boundaryProbs = calculateStrikeProbabilities(
      boundaryStrikes,
      marketDetail.forward,
      expiryMs,
      svi ?? undefined
    );
    return SIMPLE_RANGE_WIDTHS_USD.map((w, i) => {
      const loIdx = i * 2;
      const hiIdx = i * 2 + 1;
      const lo = boundaryProbs[loIdx]?.downProb ?? 0;
      const hi = boundaryProbs[hiIdx]?.downProb ?? 0;
      // downProb is 0–100; formatPct wants 0–1
      return { width: w, insideProb: Math.max(0, (hi - lo) / 100) };
    });
  }, [marketDetail, centerStrike, expiryMs, svi]);

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
  const dayTime = formatExpiryDayTime(expiryMs);
  const question =
    marketType === 'range'
      ? `${asset} price range on ${dayTime}?`
      : `${asset} price on ${dayTime}?`;

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
                  className="text-xs shrink-0 font-mono"
                  style={{ color: green }}
                >
                  {expiryMs > 0 ? (
                    <>
                      Expires in <Countdown expiryMs={expiryMs} />
                    </>
                  ) : (
                    '—'
                  )}
                </span>
              </div>

              <h2 className="text-lg font-bold  leading-snug" style={{ color: textPrimary }}>
                {showSkeleton ? '…' : question}
              </h2>
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
          ) : marketType === 'binary' ? (
            // Drop near-certain / near-zero strikes (UP prob ≤ 2% or ≥ 98%)
            // — they're visually indistinguishable from 0/1 and not
            // tradeable. Same strict bounds as the range-mode filter.
            probs
              .map((p, i) => ({ strike: strikes[i], p }))
              .filter(({ p }) => p.upProb > 2 && p.upProb < 98)
              .map(({ strike, p }) => {
                const isCenter = strike === centerStrike;
              return (
                <div
                  key={strike}
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
                      {formatPrice(strike)}
                    </span>
                    {isCenter && (
                      <span className="text-[10px]" style={{ color: textSecondary }}>
                        SPOT
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setModal({ open: true, strike, direction: 'up' });
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
                        setModal({ open: true, strike, direction: 'down' });
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
          ) : (
            // Range mode: 3 preset bands centered on the spot, each with
            // an IN button that opens RangeTradeModal directly. Matches
            // the RangeCard row layout (label + action button).
            // Drop near-certain / near-zero bands — they're either
            // collapsed (SVI sigma → 0) or not tradeable.
            SIMPLE_RANGE_WIDTHS_USD
              .map((w, i) => {
                const center = centerStrike > 0 ? centerStrike : Math.round(spotUsd);
                const lo = Math.max(0, center - w);
                const hi = center + w;
                const canTrade = center > 0 && lo > 0;
                const insideProb = rangeOdds[i]?.insideProb ?? 0;
                return { w, lo, hi, canTrade, insideProb };
              })
              .filter(({ insideProb }) => insideProb > RANGE_MIN_PROB && insideProb < RANGE_MAX_PROB)
              .map(({ w, lo, hi, canTrade, insideProb }) => (
                <div
                  key={w}
                  className="w-full flex items-center justify-between rounded-xl px-3 py-2 mb-1"
                >
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span
                      className="text-base font-semibold truncate"
                      style={{ color: textPrimary }}
                    >
                      {formatPrice(lo)} – {formatPrice(hi)}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={!canTrade}
                    onClick={() =>
                      setRangeModal({ open: true, lower: lo, upper: hi, widthUsd: w })
                    }
                    className="relative rounded-2xl px-3 py-2 overflow-hidden border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed min-w-[5.5rem]"
                    style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
                  >
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
                    <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                    <div
                      className="absolute -top-4 -right-4 w-12 h-12 rounded-full pointer-events-none"
                      style={{ background: green, filter: 'blur(30px)', opacity: 0.15 }}
                    />
                    <span
                      className="relative z-10 text-sm font-semibold"
                      style={{ color: green }}
                    >
                      ↔ IN{` `}{(insideProb).toFixed(2)}
                    </span>
                  </button>
                </div>
              ))
          )}
        </div>

        <div className='flex'>
          <div
            className="inline-flex items-center  rounded-lg p-0.5 gap-0.5 mx-auto"
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

      {currentMarket && marketType === 'range' && rangeModal.lower > 0 && rangeModal.upper > rangeModal.lower && (
        <RangeTradeModal
          open={rangeModal.open}
          onClose={() => setRangeModal((m) => ({ ...m, open: false }))}
          market={{
            oracleId: currentMarket.oracle_id,
            asset,
            expiryMs,
            spotUsd,
          }}
          lower={rangeModal.lower}
          upper={rangeModal.upper}
          triggerStrike={centerStrike}
          widthUsd={rangeModal.widthUsd}
        />
      )}

      {/* {currentMarket && leveragedOpen && (
        <LeveragedBetModal
          oracleId={currentMarket.oracle_id}
          expiryMs={expiryMs}
          spotUsd={spotUsd}
          mode={marketType}
          strike={marketType === 'binary' ? spotUsd : undefined}
          lower={
            marketType === 'range' && rangeModal.lower > 0
              ? rangeModal.lower
              : spotUsd > 0
                ? spotUsd * 0.99
                : undefined
          }
          higher={
            marketType === 'range' && rangeModal.upper > 0
              ? rangeModal.upper
              : spotUsd > 0
                ? spotUsd * 1.01
                : undefined
          }
          onClose={() => setLeveragedOpen(false)}
        />
      )} */}
    </div>
  );
}
