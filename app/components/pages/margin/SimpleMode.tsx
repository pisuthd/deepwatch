'use client';

import { useState } from 'react';
import GlassCard from '../../common/GlassCard';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

function LeverageSlider({ max = 5, value, onChange }: { max?: number; value: number; onChange: (v: number) => void }) {
  const stops = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs" style={{ color: textSecondary }}>Leverage</span>
        <span className="text-sm font-bold" style={{ color: green }}>{value}x</span>
      </div>
      <div className="relative h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div
          className="absolute top-0 left-0 h-full rounded-full transition-all"
          style={{ width: `${(value / max) * 100}%`, background: green }}
        />
      </div>
      <div className="flex justify-between mt-2">
        {stops.map((s) => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className="text-xs w-7 h-7 rounded-full transition-colors"
            style={{
              background: s === value ? green : 'rgba(255,255,255,0.05)',
              color: s === value ? '#000' : textSecondary,
              fontWeight: s === value ? 700 : 500,
            }}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

export default function MarginSimpleMode() {
  const [leverage, setLeverage] = useState(2);

  return (
    <div className="max-w-md mx-auto space-y-3">
      <GlassCard>
        <div className="text-xs" style={{ color: textSecondary }}>BTC / USDC</div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-3xl font-bold" style={{ color: green }}>$71,400.00</span>
          <span className="text-xs" style={{ color: textSecondary }}>+2.34%</span>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="space-y-4">
          <LeverageSlider value={leverage} onChange={setLeverage} />
          <div>
            <label className="text-xs" style={{ color: textSecondary }}>Amount (USDC)</label>
            <input
              type="text"
              placeholder="0.00"
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 text-sm font-semibold text-white outline-none focus:border-white/30"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
              style={{ background: green, color: '#000' }}
            >
              Long
            </button>
            <button
              className="py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
              style={{ background: red, color: '#fff' }}
            >
              Short
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
