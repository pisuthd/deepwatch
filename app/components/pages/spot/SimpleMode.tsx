'use client';

import { ArrowDownUp } from 'lucide-react';
import GlassCard from '../../common/GlassCard';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

export default function SpotSimpleMode() {
  return (
    <div className="max-w-md mx-auto space-y-3">
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

      <GlassCard>
        <div className="space-y-3">
          <div>
            <label className="text-xs" style={{ color: textSecondary }}>Amount (USDC)</label>
            <input
              type="text"
              placeholder="0.00"
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 text-sm font-semibold text-white outline-none focus:border-white/30"
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: textSecondary }}>Total</span>
            <span style={{ color: textPrimary }}>$0.00</span>
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
  );
}
