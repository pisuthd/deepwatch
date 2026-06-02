'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

interface MarketCarouselProps {
  currentIdx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export default function MarketCarousel({ currentIdx, total, onPrev, onNext }: MarketCarouselProps) {
  const { isDark } = useTheme();
  const textSecondary = isDark ? '#9ca3af' : '#71717a';

  return (
    <div className="flex items-center justify-center gap-4">
      <button 
        onClick={onPrev} 
        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center transition-all hover:scale-105" 
        style={{ background: isDark ? 'rgba(40, 44, 60, 0.5)' : 'rgba(248, 249, 250, 0.9)' }}
      >
        <ChevronLeft size={18} style={{ color: textSecondary }} />
      </button>
      
      <span className="text-xs" style={{ color: textSecondary }}>
        {currentIdx + 1} / {total}
      </span>

      <button 
        onClick={onNext} 
        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center transition-all hover:scale-105" 
        style={{ background: isDark ? 'rgba(40, 44, 60, 0.5)' : 'rgba(248, 249, 250, 0.9)' }}
      >
        <ChevronRight size={18} style={{ color: textSecondary }} />
      </button>
    </div>
  );
}