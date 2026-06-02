'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  type UTCTimestamp,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';

const textSecondary = '#9ca3af';
const muted = 'rgba(180,200,255,0.6)';

interface CandlestickChartProps {
  fetchCandles: (interval: string) => Promise<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]>;
  interval: string;
}

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

export default function CandlestickChart({ fetchCandles, interval }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Init chart (one-time)
  useEffect(() => {
    const container = containerRef.current;
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
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00E68A',
      downColor: '#ef4444',
      borderUpColor: '#00E68A',
      borderDownColor: '#ef4444',
      wickUpColor: '#00E68A',
      wickDownColor: '#ef4444',
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
    };
  }, []);

  // Feed data on interval or fetchCandles change
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const candles = await fetchCandles(interval);
        if (cancelled) return;
        // Dedupe by timestamp (last-write-wins) then sort asc.
        const deduped = new Map<number, { open: number; high: number; low: number; close: number }>();
        for (const c of candles) {
          deduped.set(c.time, { open: c.open, high: c.high, low: c.low, close: c.close });
        }
        const data = Array.from(deduped.entries())
          .sort(([a], [b]) => a - b)
          .map(([time, v]) => ({ time: time as UTCTimestamp, ...v }));
        series.setData(data);
        chartRef.current?.timeScale().fitContent();
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load chart');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [interval, fetchCandles]);

  return (
    <div className="relative w-full h-full min-h-[280px]">
      {/* Interval selector */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
        {INTERVALS.map((iv) => (
          <span
            key={iv}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{
              background: iv === interval ? 'rgba(62,196,192,0.15)' : 'rgba(255,255,255,0.04)',
              color: iv === interval ? '#3EC4C0' : textSecondary,
            }}
          >
            {iv}
          </span>
        ))}
      </div>
      {loading && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none"
          style={{ color: textSecondary }}
        >
          <div className="flex items-center gap-2 text-xs">
            <Loader2 size={14} className="animate-spin" style={{ color: '#3EC4C0' }} />
            Loading chart…
          </div>
        </div>
      )}
      {error && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none text-xs"
          style={{ color: '#ef4444' }}
        >
          {error}
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 280,
          opacity: loading ? 0.3 : 1,
          transition: 'opacity 200ms',
        }}
      />
    </div>
  );
}
