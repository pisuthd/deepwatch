'use client';

import { useState } from 'react';
import GlassCard from '../../common/GlassCard';

const green = '#00E68A';
const red = '#ef4444';
const amber = '#f59e0b';
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

function RiskMetric({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between text-xs py-1.5">
      <span style={{ color: textSecondary }}>{label}</span>
      <span className="font-mono font-semibold" style={{ color: valueColor ?? textPrimary }}>{value}</span>
    </div>
  );
}

export default function MarginAdvancedMode() {
  const [leverage, setLeverage] = useState(3);

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GlassCard>
          <div className="text-xs" style={{ color: textSecondary }}>BTC / USDC Perpetual</div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold" style={{ color: green }}>$71,400.00</span>
          </div>
          <div className="text-xs mt-1" style={{ color: textSecondary }}>Mark / Index / Funding in 02:14:33</div>
        </GlassCard>

        <GlassCard>
          <div className="text-xs font-semibold mb-2" style={{ color: textPrimary }}>Position</div>
          <RiskMetric label="Size" value="0.5000 BTC" />
          <RiskMetric label="Entry" value="$71,200.00" />
          <RiskMetric label="Unrealized PnL" value="+$100.00" valueColor={green} />
        </GlassCard>

        <GlassCard>
          <div className="text-xs font-semibold mb-2" style={{ color: textPrimary }}>Risk</div>
          <RiskMetric label="Liquidation Price" value="$56,940.00" valueColor={red} />
          <RiskMetric label="Margin Ratio" value="382%" />
          <RiskMetric label="Funding Rate" value="0.0100%" valueColor={amber} />
        </GlassCard>
      </div>

      <GlassCard>
        <div className="space-y-4">
          <LeverageSlider max={10} value={leverage} onChange={setLeverage} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs" style={{ color: textSecondary }}>Limit Price</label>
              <input
                type="text"
                defaultValue="71,400.00"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm font-mono text-white outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="text-xs" style={{ color: textSecondary }}>Size (BTC)</label>
              <input
                type="text"
                placeholder="0.0000"
                className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm font-mono text-white outline-none focus:border-white/30"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="px-2 py-1.5 rounded-md text-center" style={{ background: 'rgba(255,255,255,0.05)', color: textSecondary }}>Reduce-Only</div>
            <div className="px-2 py-1.5 rounded-md text-center" style={{ background: 'rgba(255,255,255,0.05)', color: textSecondary }}>Post-Only</div>
            <div className="px-2 py-1.5 rounded-md text-center" style={{ background: 'rgba(255,255,255,0.05)', color: textSecondary }}>TP/SL</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
              style={{ background: green, color: '#000' }}
            >
              Open Long
            </button>
            <button
              className="py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
              style={{ background: red, color: '#fff' }}
            >
              Open Short
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
