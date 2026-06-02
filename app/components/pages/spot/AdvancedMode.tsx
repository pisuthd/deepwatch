'use client';

import { ArrowDownUp } from 'lucide-react';
import GlassCard from '../../common/GlassCard';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const ORDER_BOOK = [
  { price: 71420, size: 0.42, side: 'ask' as const },
  { price: 71415, size: 1.18, side: 'ask' as const },
  { price: 71408, size: 0.85, side: 'ask' as const },
  { price: 71400, size: 2.31, side: 'mid' as const },
  { price: 71392, size: 1.04, side: 'bid' as const },
  { price: 71385, size: 0.67, side: 'bid' as const },
  { price: 71380, size: 0.93, side: 'bid' as const },
];

export default function SpotAdvancedMode() {
  const maxSize = Math.max(...ORDER_BOOK.map((o) => o.size));

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <GlassCard>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs" style={{ color: textSecondary }}>BTC / USDC</span>
          <ArrowDownUp size={14} style={{ color: textSecondary }} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold" style={{ color: green }}>$71,400.00</span>
          <span className="text-xs" style={{ color: textSecondary }}>+2.34%</span>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <GlassCard>
          <div className="text-xs font-semibold mb-2" style={{ color: textPrimary }}>Order Book</div>
          <div className="space-y-1">
            {ORDER_BOOK.map((row, i) => {
              const widthPct = (row.size / maxSize) * 100;
              const color = row.side === 'ask' ? red : row.side === 'bid' ? green : textSecondary;
              const bg = row.side === 'ask' ? 'rgba(239,68,68,0.12)' : row.side === 'bid' ? 'rgba(0,230,138,0.12)' : 'transparent';
              return (
                <div key={i} className="relative flex items-center justify-between px-2 py-1 text-xs">
                  <div
                    className="absolute inset-y-0 right-0 rounded"
                    style={{ width: `${widthPct}%`, background: bg }}
                  />
                  <span className="relative" style={{ color }}>${row.price.toLocaleString()}</span>
                  <span className="relative" style={{ color: textPrimary }}>{row.size.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button className="py-1.5 rounded-md font-semibold" style={{ background: 'rgba(255,255,255,0.08)', color: textPrimary }}>Limit</button>
              <button className="py-1.5 rounded-md" style={{ color: textSecondary }}>Market</button>
            </div>
            <div>
              <label className="text-xs" style={{ color: textSecondary }}>Price (USDC)</label>
              <input
                type="text"
                defaultValue="71,400.00"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm font-mono text-white outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: textSecondary }}>Amount (BTC)</label>
              <input
                type="text"
                placeholder="0.0000"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm font-mono text-white outline-none focus:border-white/30"
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: textSecondary }}>Total</span>
              <span style={{ color: textPrimary }}>0.00 USDC</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                className="py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
                style={{ background: green, color: '#000' }}
              >
                Buy
              </button>
              <button
                className="py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
                style={{ background: red, color: '#fff' }}
              >
                Sell
              </button>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
