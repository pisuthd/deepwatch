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
const DRAG_THRESHOLD_PX = 8;

interface PriceChartProps {
  oracleId: string | null;
  strike: number;
  onStrikeChange: (s: number) => void;
}

export default function PriceChart({
  oracleId,
  strike,
  onStrikeChange,
}: PriceChartProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const strikeLineRef = useRef<IPriceLine | null>(null);
  const lineInitRef = useRef<boolean>(false);
  const draggingRef = useRef<boolean>(false);
  const pointerDownRef = useRef<boolean>(false);
  const onStrikeChangeRef = useRef(onStrikeChange);
  onStrikeChangeRef.current = onStrikeChange;
  const strikeRef = useRef<number>(strike);
  strikeRef.current = strike;

  const { history, loading } = useMarketPrices(oracleId, 60, 15_000);

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
      strikeLineRef.current = null;
      lineInitRef.current = false;
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

  // ─── 3. Create the strike line on first valid data ──────────────────────
  // Re-runs when EITHER history or strike changes, so the line is created
  // as soon as either is available (avoids first-load race when parent
  // strike is 0 until spot resolves).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (lineInitRef.current) return;
    if (!history?.prices?.length && (!strikeRef.current || strikeRef.current <= 0)) {
      return;
    }

    if (strikeLineRef.current) {
      try {
        series.removePriceLine(strikeLineRef.current);
      } catch {
        // ignore
      }
      strikeLineRef.current = null;
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

    strikeLineRef.current = series.createPriceLine({
      price: useStrike,
      color: cyan,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Strike',
    });
    lineInitRef.current = true;
    // Force a redraw so the dashed line shows up immediately
    chartRef.current?.timeScale().fitContent();
  }, [history, strike]);

  // ─── 4. Sync line from prop changes (e.g. market switch) ─────────────────
  useEffect(() => {
    if (!lineInitRef.current) return;
    if (pointerDownRef.current) return;
    if (!strikeLineRef.current) return;
    if (!strike || strike <= 0) return;
    strikeLineRef.current.applyOptions({ price: strike });
  }, [strike]);

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

    const hitTest = (clientY: number): boolean => {
      const series = seriesRef.current;
      if (!series) return false;
      const rect = container.getBoundingClientRect();
      const y = clientY - rect.top;
      const p = getLinePrice(strikeLineRef.current);
      if (p === null) return false;
      const coord = series.priceToCoordinate(p);
      if (coord === null) return false;
      return Math.abs(y - coord) < DRAG_THRESHOLD_PX;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!hitTest(e.clientY)) return;
      draggingRef.current = true;
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
      const newPrice = series.coordinateToPrice(y);
      if (newPrice === null) return;
      const rounded = parseFloat(newPrice.toFixed(2));
      if (strikeLineRef.current) {
        strikeLineRef.current.applyOptions({ price: rounded });
        onStrikeChangeRef.current(rounded);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pointerDownRef.current) return;
      draggingRef.current = false;
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
