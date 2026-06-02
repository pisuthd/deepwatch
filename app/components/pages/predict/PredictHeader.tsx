'use client';

import { useTheme } from '../../../context/ThemeContext';

interface PredictHeaderProps {
  question: string;
  spotPrice: number;
  marketName: string;
  expiry: string;
}

export default function PredictHeader({ question, spotPrice, marketName, expiry }: PredictHeaderProps) {
  const { isDark } = useTheme();
  const green = '#00E68A';
  const textPrimary = isDark ? '#ffffff' : '#111827';
  const textSecondary = isDark ? '#9ca3af' : '#71717a';

  return (
    <div className="relative overflow-hidden rounded-2xl p-5" style={{ 
      background: isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)', 
      backdropFilter: 'blur(20px)',
      border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.05)'
    }}>
      <div className={`absolute inset-0 rounded-2xl ${isDark ? 'bg-gradient-to-br from-white/5 to-transparent' : 'bg-gradient-to-br from-white/80 to-transparent'}`} />
      <div className={`absolute top-0 left-0 w-full h-px ${isDark ? 'bg-gradient-to-r from-transparent via-white/20 to-transparent' : 'bg-gradient-to-r from-transparent via-black/10 to-transparent'}`} />
      <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full" style={{ background: green, filter: 'blur(80px)', opacity: isDark ? 0.15 : 0.1 }} />
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold" style={{ color: textPrimary }}>{question}</h2>
          <span className="text-xs px-2 py-1 rounded" style={{ background: isDark ? 'rgba(40, 44, 60, 0.5)' : 'rgba(248, 249, 250, 0.9)', color: textSecondary }}>
            {expiry}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: textSecondary }}>Spot</span>
            <span className="text-2xl font-bold" style={{ color: green }}>${spotPrice.toLocaleString()}</span>
          </div>
          <div className="w-8 h-8 rounded-lg bg-accent-primary/20 flex items-center justify-center">
            <span className="text-xs font-bold" style={{ color: green }}>{marketName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}