'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useSpotPools, type OrderBook as OrderBookData } from '../../../hooks/useSpotPools';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

interface OrderBookProps {
  poolName: string;
  pollMs?: number;
}

function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export default function OrderBookView({ poolName, pollMs = 2_000 }: OrderBookProps) {
  const { getOrderBook } = useSpotPools();
  const [book, setBook] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const b = await getOrderBook(poolName);
        if (!cancelled) setBook(b);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
        if (!cancelled) timer = setTimeout(tick, pollMs);
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [poolName, getOrderBook, pollMs]);

  if (loading && !book) {
    return (
      <div className="flex items-center justify-center h-32 text-xs" style={{ color: textSecondary }}>
        <Loader2 size={14} className="animate-spin" style={{ color: '#3EC4C0' }} />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="text-center text-xs py-6" style={{ color: textSecondary }}>
        No order book data.
      </div>
    );
  }

  const maxTotal = Math.max(
    book.bids.length ? book.bids[book.bids.length - 1].total : 0,
    book.asks.length ? book.asks[book.asks.length - 1].total : 0,
    1,
  );

  return (
    <div className="space-y-2">
      {/* Column header (Price / Size). The "Order Book" title and pool name
          are now surfaced by the parent tab in `AdvancedMode.tsx`, so this
          component skips its own header to avoid duplication. */}
      <div className="grid grid-cols-2 text-[10px] uppercase tracking-wide px-2" style={{ color: textSecondary }}>
        <span>Price</span>
        <span className="text-right">Size</span>
      </div>

      {/* Asks (reversed so best ask is at bottom near mid) */}
      <div className="space-y-px">
        {[...book.asks].reverse().map((a, i) => {
          const widthPct = (a.total / maxTotal) * 100;
          return (
            <div
              key={`a${i}`}
              className="relative flex items-center justify-between px-2 py-0.5 text-[11px] font-mono"
            >
              <div
                className="absolute inset-y-0 right-0"
                style={{ width: `${widthPct}%`, background: 'rgba(239,68,68,0.12)' }}
              />
              <span className="relative" style={{ color: red }}>{fmt(a.price, 4)}</span>
              <span className="relative" style={{ color: textPrimary }}>{fmt(a.quantity, 4)}</span>
            </div>
          );
        })}
      </div>

      {/* Spread — mid price is a relative rate (base per quote), no $ prefix. */}
      <div
        className="flex items-center justify-between px-2 py-1 text-[11px] font-mono"
        style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}
      >
        <span style={{ color: textPrimary }}>{fmt(book.midPrice, 4)}</span>
        <span style={{ color: textSecondary }}>spread {fmt(book.spreadPercent, 3)}%</span>
      </div>

      {/* Bids */}
      <div className="space-y-px">
        {book.bids.map((b, i) => {
          const widthPct = (b.total / maxTotal) * 100;
          return (
            <div
              key={`b${i}`}
              className="relative flex items-center justify-between px-2 py-0.5 text-[11px] font-mono"
            >
              <div
                className="absolute inset-y-0 right-0"
                style={{ width: `${widthPct}%`, background: 'rgba(0,230,138,0.12)' }}
              />
              <span className="relative" style={{ color: green }}>{fmt(b.price, 4)}</span>
              <span className="relative" style={{ color: textPrimary }}>{fmt(b.quantity, 4)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
