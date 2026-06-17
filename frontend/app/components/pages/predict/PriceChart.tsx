'use client';

import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import {
  createChart,
  ColorType,
  LineSeries,
  LineStyle,
  type UTCTimestamp,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
} from 'lightweight-charts';
import { useMarketPrices } from '../../../hooks/useMarketPrices';

const textSecondary = '#9ca3af';
const muted = 'rgba(180,200,255,0.6)';
const cyan = '#3EC4C0';
const upperColor = '#EC4899';
const DRAG_THRESHOLD_PX = 8;
const DRAG_TICK_USD = 1000;

interface PriceChartProps {
  oracleId: string | null;
  strike: number;
  onStrikeChange: (s: number) => void;
  // Range mode — optional. When provided (along with `upper`),
  // the chart shows two draggable lines instead of one.
  lower?: number;
  upper?: number;
  onRangeChange?: (lower: number, upper: number) => void;
}

export default function PriceChart({
  oracleId,
  strike,
  onStrikeChange,
  lower,
  upper,
  onRangeChange,
}: PriceChartProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  // Three independent line refs so we can switch modes without
  // touching the others. Binary and range lines never coexist visually.
  const binaryLineRef = useRef<IPriceLine | null>(null);
  const lowerLineRef = useRef<IPriceLine | null>(null);
  const upperLineRef = useRef<IPriceLine | null>(null);
  const binaryInitRef = useRef<boolean>(false);
  const lowerInitRef = useRef<boolean>(false);
  const upperInitRef = useRef<boolean>(false);
  // Which line was hit on the current drag. Null = not dragging.
  type DragKind = 'binary' | 'lower' | 'upper';
  const dragKindRef = useRef<DragKind | null>(null);
  const pointerDownRef = useRef<boolean>(false);

  // Keep latest callbacks / values in refs so the effect deps stay narrow.
  const onStrikeChangeRef = useRef(onStrikeChange);
  onStrikeChangeRef.current = onStrikeChange;
  const onRangeChangeRef = useRef(onRangeChange);
  onRangeChangeRef.current = onRangeChange;
  const strikeRef = useRef<number>(strike);
  strikeRef.current = strike;
  const lowerRef = useRef<number>(lower ?? 0);
  lowerRef.current = lower ?? 0;
  const upperRef = useRef<number>(upper ?? 0);
  upperRef.current = upper ?? 0;

  const { history, loading } = useMarketPrices(oracleId, 60, 15_000);
  // Range mode is active when both bounds are present.
  const isRangeMode = typeof lower === 'number' && typeof upper === 'number';

  // ─── 1. Init chart (one-time) ────────────────────────────────────────────
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: muted,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
      width: Math.max(Math.round(rect.width), 100),
      height: Math.max(Math.round(rect.height), 100),
    });
    const series = chart.addSeries(LineSeries, {
      color: '#ffffff',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    chart.timeScale().fitContent();

    // Track parent size so the chart fills the available area.
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !chartRef.current) return;
      const { width, height } = entry.contentRect;
      chartRef.current.applyOptions({
        width: Math.max(Math.round(width), 100),
        height: Math.max(Math.round(height), 100),
      });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      binaryLineRef.current = null;
      lowerLineRef.current = null;
      upperLineRef.current = null;
      binaryInitRef.current = false;
      lowerInitRef.current = false;
      upperInitRef.current = false;
    };
  }, []);

  // ─── 2. Feed data ─────────────────────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !history?.prices?.length) return;
    // Dedupe by timestamp (last-write-wins) then sort asc — lightweight-charts
    // requires strictly increasing unique times, and the server may return
    // multiple points that share a second.
    const deduped = new Map<number, number>();
    for (const p of history.prices) {
      deduped.set(Math.floor(p.time / 1000), Number(p.spot));
    }
    const data = Array.from(deduped.entries())
      .sort(([a], [b]) => a - b)
      .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [history]);

  // ─── 3a. Create the binary line on first valid data ─────────────────────
  // Re-runs when EITHER history or strike changes, so the line is created
  // as soon as either is available (avoids first-load race when parent
  // strike is 0 until spot resolves).
  useEffect(() => {
    if (isRangeMode) return;
    const series = seriesRef.current;
    if (!series) return;
    if (binaryInitRef.current) return;
    if (!history?.prices?.length && (!strikeRef.current || strikeRef.current <= 0)) {
      return;
    }

    if (binaryLineRef.current) {
      try {
        series.removePriceLine(binaryLineRef.current);
      } catch {
        // ignore
      }
      binaryLineRef.current = null;
    }

    let useStrike = strikeRef.current;
    if (!useStrike || useStrike <= 0) {
      const prices = history?.prices ?? [];
      const midIdx = Math.floor(prices.length / 2);
      const mid = prices[midIdx]?.spot ?? 0;
      useStrike = parseFloat((mid * 0.99).toFixed(2));
      if (useStrike > 0) {
        onStrikeChangeRef.current(useStrike);
      }
    }
    if (useStrike <= 0) return;

    binaryLineRef.current = series.createPriceLine({
      price: useStrike,
      color: cyan,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Strike',
    });
    binaryInitRef.current = true;
    // Force a redraw so the dashed line shows up immediately
    chartRef.current?.timeScale().fitContent();
  }, [history, strike, isRangeMode]);

  // ─── 3b. Create the lower + upper range lines ───────────────────────────
  // Same first-load race guard as the binary init effect.
  useEffect(() => {
    if (!isRangeMode) return;
    const series = seriesRef.current;
    if (!series) return;

    if (!history?.prices?.length && (lowerRef.current <= 0 || upperRef.current <= 0)) {
      return;
    }

    // Tear down binary line if it exists from a previous mode.
    if (binaryLineRef.current) {
      try {
        series.removePriceLine(binaryLineRef.current);
      } catch {
        // ignore
      }
      binaryLineRef.current = null;
      binaryInitRef.current = false;
    }

    // Ensure we have valid bounds before drawing.
    if (lowerRef.current <= 0 || upperRef.current <= 0) return;

    if (!lowerInitRef.current) {
      lowerLineRef.current = series.createPriceLine({
        price: lowerRef.current,
        color: cyan,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Lower',
      });
      lowerInitRef.current = true;
    }
    if (!upperInitRef.current) {
      upperLineRef.current = series.createPriceLine({
        price: upperRef.current,
        color: upperColor,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Upper',
      });
      upperInitRef.current = true;
    }

    chartRef.current?.timeScale().fitContent();
  }, [history, isRangeMode]);

  // ─── 4a. Sync binary line from prop changes (e.g. market switch) ────────
  useEffect(() => {
    if (isRangeMode) return;
    if (!binaryInitRef.current) return;
    if (pointerDownRef.current) return;
    if (!binaryLineRef.current) return;
    if (!strike || strike <= 0) return;
    binaryLineRef.current.applyOptions({ price: strike });
  }, [strike, isRangeMode]);

  // ─── 4b. Sync range lines from prop changes ─────────────────────────────
  useEffect(() => {
    if (!isRangeMode) return;
    if (pointerDownRef.current) return;
    if (lowerInitRef.current && lowerLineRef.current && typeof lower === 'number' && lower > 0) {
      lowerLineRef.current.applyOptions({ price: lower });
    }
    if (upperInitRef.current && upperLineRef.current && typeof upper === 'number' && upper > 0) {
      upperLineRef.current.applyOptions({ price: upper });
    }
  }, [lower, upper, isRangeMode]);

  // ─── 5. Drag handlers on the wrapper ─────────────────────────────────────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const container = chartContainerRef.current;
    if (!wrapper || !container) return;

    const getLinePrice = (line: IPriceLine | null): number | null => {
      if (!line) return null;
      try {
        return (line as unknown as { options(): { price: number } }).options()
          .price;
      } catch {
        return null;
      }
    };

    // Returns whichever visible line is closest to the cursor within
    // DRAG_THRESHOLD_PX, or null. Binary and range lines never coexist
    // visually — the unused refs are null while the other mode is active.
    const hitTest = (clientY: number): DragKind | null => {
      const series = seriesRef.current;
      if (!series) return null;
      const rect = container.getBoundingClientRect();
      const y = clientY - rect.top;

      const candidates: { kind: DragKind; price: number }[] = [];
      if (binaryLineRef.current) {
        candidates.push({ kind: 'binary', price: getLinePrice(binaryLineRef.current) ?? NaN });
      }
      if (lowerLineRef.current) {
        candidates.push({ kind: 'lower', price: getLinePrice(lowerLineRef.current) ?? NaN });
      }
      if (upperLineRef.current) {
        candidates.push({ kind: 'upper', price: getLinePrice(upperLineRef.current) ?? NaN });
      }

      let best: { kind: DragKind; dist: number } | null = null;
      for (const c of candidates) {
        if (!Number.isFinite(c.price)) continue;
        const coord = series.priceToCoordinate(c.price);
        if (coord === null) continue;
        const dist = Math.abs(y - coord);
        if (dist < DRAG_THRESHOLD_PX && (best === null || dist < best.dist)) {
          best = { kind: c.kind, dist };
        }
      }
      return best?.kind ?? null;
    };

    // Snap a raw pixel→price coordinate to the nearest $1,000 tick so
    // the lines land on round numbers and the band math stays clean.
    const snapToTick = (v: number): number =>
      Math.max(0, Math.round(v / DRAG_TICK_USD) * DRAG_TICK_USD);

    const onPointerDown = (e: PointerEvent) => {
      const kind = hitTest(e.clientY);
      if (!kind) return;
      dragKindRef.current = kind;
      pointerDownRef.current = true;
      try {
        wrapper.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      wrapper.style.cursor = 'ns-resize';
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const series = seriesRef.current;
      if (!series) return;
      if (!pointerDownRef.current) {
        wrapper.style.cursor = hitTest(e.clientY) ? 'ns-resize' : 'default';
        return;
      }
      const rect = container.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const rawPrice = series.coordinateToPrice(y);
      if (rawPrice === null) return;
      const rounded = snapToTick(rawPrice);

      const kind = dragKindRef.current;
      if (kind === 'binary') {
        if (binaryLineRef.current) {
          binaryLineRef.current.applyOptions({ price: rounded });
          onStrikeChangeRef.current(rounded);
        }
      } else if (kind === 'lower') {
        // Clamp so the lower line can never meet or exceed the upper.
        const maxLower = upperRef.current - DRAG_TICK_USD;
        const next = Math.min(rounded, maxLower);
        if (lowerLineRef.current) {
          lowerLineRef.current.applyOptions({ price: next });
          onRangeChangeRef.current?.(next, upperRef.current);
        }
      } else if (kind === 'upper') {
        // Clamp so the upper line can never meet or drop below the lower.
        const minUpper = lowerRef.current + DRAG_TICK_USD;
        const next = Math.max(rounded, minUpper);
        if (upperLineRef.current) {
          upperLineRef.current.applyOptions({ price: next });
          onRangeChangeRef.current?.(lowerRef.current, next);
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pointerDownRef.current) return;
      dragKindRef.current = null;
      pointerDownRef.current = false;
      try {
        wrapper.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      wrapper.style.cursor = 'default';
    };

    wrapper.addEventListener('pointerdown', onPointerDown);
    wrapper.addEventListener('pointermove', onPointerMove);
    wrapper.addEventListener('pointerup', onPointerUp);
    wrapper.addEventListener('pointercancel', onPointerUp);
    return () => {
      wrapper.removeEventListener('pointerdown', onPointerDown);
      wrapper.removeEventListener('pointermove', onPointerMove);
      wrapper.removeEventListener('pointerup', onPointerUp);
      wrapper.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  const dimmed = loading || !history?.prices?.length;

  return (
    <div ref={wrapperRef} className="relative select-none">
      {loading && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
          style={{ color: textSecondary }}
        >
          <div className="flex items-center gap-2 text-xs">
            <Loader2 size={14} className="animate-spin" style={{ color: cyan }} />
            Loading chart…
          </div>
        </div>
      )}
      {!loading && !history?.prices?.length && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
          style={{ color: textSecondary }}
        >
          <span className="text-xs">No chart data available</span>
        </div>
      )}
      <div
        ref={chartContainerRef}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 280,
          opacity: dimmed ? 0.3 : 1,
          transition: 'opacity 200ms',
          touchAction: 'none',
        }}
      />
    </div>
  );
}