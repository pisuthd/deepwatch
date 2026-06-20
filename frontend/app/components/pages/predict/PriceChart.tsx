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
const MIN_RANGE_GAP_USD = 1;

interface PriceChartProps {
  oracleId: string | null;
  strike: number;
  onStrikeChange: (s: number) => void;
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
  const binaryLineRef = useRef<IPriceLine | null>(null);
  const lowerLineRef = useRef<IPriceLine | null>(null);
  const upperLineRef = useRef<IPriceLine | null>(null);
  type DragKind = 'binary' | 'lower' | 'upper';
  const dragKindRef = useRef<DragKind | null>(null);
  const pointerDownRef = useRef<boolean>(false);

  // Latest callbacks / values in refs.
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
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.08)',
        autoScale: true,
      },
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
      // CRITICAL: lightweight-charts v5 does NOT include price lines in the
      // default autoscale calculation. Without this provider, the chart
      // zooms tightly onto the data range and our drag-handle lines
      // disappear off-screen. We merge them in manually.
      autoscaleInfoProvider: (original: () => unknown) => {
        const res = original() as { priceRange?: { minValue: number; maxValue: number } } | null;
        if (!res || !res.priceRange) return res;
        let { minValue, maxValue } = res.priceRange;
        const lines = series.priceLines();
        for (const line of lines) {
          try {
            const p = line.options().price;
            if (!Number.isFinite(p)) continue;
            if (p < minValue) minValue = p;
            if (p > maxValue) maxValue = p;
          } catch {
            // ignore
          }
        }
        if (minValue === maxValue) {
          // Avoid zero-range which makes the chart angry.
          const pad = Math.max(1, Math.abs(minValue) * 0.01);
          minValue -= pad;
          maxValue += pad;
        }
        return { ...res, priceRange: { minValue, maxValue } };
      },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    chart.timeScale().fitContent();

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
    };
  }, []);

  // ─── 2. Feed data ─────────────────────────────────────────────────────────
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !history?.prices?.length) return;
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

  // ─── 3. Price lines — always recreate from current state. ────────────────
  // No init-flag, no mode-change effect. Just: tear down everything, then
  // recreate exactly what the current props say. This is the simplest
  // possible logic that matches what the user wants to see.
  //
  // Skip recreation while the user is dragging (pointerDownRef) so the
  // line being dragged doesn't get torn down mid-gesture.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (pointerDownRef.current) return;

    // Tear down every existing line first.
    if (binaryLineRef.current) {
      try {
        series.removePriceLine(binaryLineRef.current);
      } catch {
        // ignore
      }
      binaryLineRef.current = null;
    }
    if (lowerLineRef.current) {
      try {
        series.removePriceLine(lowerLineRef.current);
      } catch {
        // ignore
      }
      lowerLineRef.current = null;
    }
    if (upperLineRef.current) {
      try {
        series.removePriceLine(upperLineRef.current);
      } catch {
        // ignore
      }
      upperLineRef.current = null;
    }

    if (isRangeMode) {
      // Range mode — two dashed lines.
      let lo = typeof lower === 'number' && lower > 0 ? lower : 0;
      let hi = typeof upper === 'number' && upper > 0 ? upper : 0;

      // Fallback if bounds not yet supplied by parent. Use the middle
      // of the visible price history, snap to nearest $1k.
      if ((lo <= 0 || hi <= 0) && history?.prices?.length) {
        const midIdx = Math.floor(history.prices.length / 2);
        const mid = Number(history.prices[midIdx]?.spot ?? 0);
        const fallback = parseFloat((mid * 0.99).toFixed(2));
        if (fallback > 0) {
          lo = Math.max(1, Math.round((fallback - 1000) / 1000) * 1000);
          hi = lo + 2000;
          onRangeChangeRef.current?.(lo, hi);
        }
      }

      if (lo > 0 && hi > lo) {
        lowerLineRef.current = series.createPriceLine({
          price: lo,
          color: cyan,
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Lower',
        });
        upperLineRef.current = series.createPriceLine({
          price: hi,
          color: upperColor,
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Upper',
        });
      }
    } else {
      // Binary mode — single dashed line at the strike.
      let useStrike =
        typeof strike === 'number' && strike > 0 ? strike : 0;
      if (useStrike <= 0 && history?.prices?.length) {
        const midIdx = Math.floor(history.prices.length / 2);
        const mid = Number(history.prices[midIdx]?.spot ?? 0);
        const fallback = parseFloat((mid * 0.99).toFixed(2));
        if (fallback > 0) {
          useStrike = fallback;
          onStrikeChangeRef.current(useStrike);
        }
      }
      if (useStrike > 0) {
        binaryLineRef.current = series.createPriceLine({
          price: useStrike,
          color: cyan,
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Strike',
        });
      }
    }

    // Force autoscale so newly-added lines are visible.
    try {
      series.applyOptions({ autoscale: true } as never);
      const ps = chartRef.current?.priceScale('right');
      ps?.applyOptions({ autoScale: true });
    } catch {
      // ignore
    }
    chartRef.current?.timeScale().fitContent();
  }, [history, isRangeMode, strike, lower, upper]);

  // ─── 4. Drag handlers ────────────────────────────────────────────────────
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

    const hitTest = (clientY: number): DragKind | null => {
      const series = seriesRef.current;
      if (!series) return null;
      const rect = container.getBoundingClientRect();
      const y = clientY - rect.top;

      const candidates: { kind: DragKind; price: number }[] = [];
      if (binaryLineRef.current) {
        candidates.push({
          kind: 'binary',
          price: getLinePrice(binaryLineRef.current) ?? NaN,
        });
      }
      if (lowerLineRef.current) {
        candidates.push({
          kind: 'lower',
          price: getLinePrice(lowerLineRef.current) ?? NaN,
        });
      }
      if (upperLineRef.current) {
        candidates.push({
          kind: 'upper',
          price: getLinePrice(upperLineRef.current) ?? NaN,
        });
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

    const snap = (v: number): number | null => {
      if (!Number.isFinite(v)) return null;
      if (v <= 0) return null;
      return parseFloat(v.toFixed(2));
    };

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
      const rounded = snap(Number(rawPrice));
      if (rounded === null) return;

      const kind = dragKindRef.current;
      if (kind === 'binary') {
        if (binaryLineRef.current) {
          binaryLineRef.current.applyOptions({ price: rounded });
          onStrikeChangeRef.current(rounded);
        }
      } else if (kind === 'lower') {
        const maxLower = Math.max(0, upperRef.current - MIN_RANGE_GAP_USD);
        const next = Math.min(rounded, maxLower);
        if (lowerLineRef.current) {
          lowerLineRef.current.applyOptions({ price: next });
          onRangeChangeRef.current?.(next, upperRef.current);
        }
      } else if (kind === 'upper') {
        const minUpper = lowerRef.current + MIN_RANGE_GAP_USD;
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
    <div
      ref={wrapperRef}
      className="relative select-none"
      style={{ width: '100%', height: '100%', minHeight: 320 }}
    >
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
