'use client';

import { useTheme } from '../../../context/ThemeContext';
import GlassButton from './GlassButton';

interface StrikeRowProps {
  price: number;
  upOdds: string;
  downOdds: string;
  onUp: () => void;
  onDown: () => void;
}

export default function StrikeRow({ price, upOdds, downOdds, onUp, onDown }: StrikeRowProps) {
  const { isDark } = useTheme();
  const textPrimary = isDark ? '#ffffff' : '#111827';

  return (
    <div className="w-full flex items-center justify-between rounded-xl px-3 py-2 transition-all hover:bg-white/5" style={{ background: 'transparent' }}>
      <span className="text-base font-semibold" style={{ color: textPrimary }}>
        ${price.toLocaleString()}
      </span>
      <div className="flex gap-1.5">
        <GlassButton variant="green" onClick={(e) => { e?.stopPropagation(); onUp(); }}>
          <span>▲</span><span>UP</span><span>{upOdds}</span>
        </GlassButton>
        <GlassButton variant="red" onClick={(e) => { e?.stopPropagation(); onDown(); }}>
          <span>▼</span><span>DOWN</span><span>{downOdds}</span>
        </GlassButton>
      </div>
    </div>
  );
}