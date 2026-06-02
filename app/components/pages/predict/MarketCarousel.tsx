'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MarketCarouselProps {
  currentIdx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export default function MarketCarousel({ currentIdx, total, onPrev, onNext }: MarketCarouselProps) {
  return (
    <div className="flex items-center justify-center gap-4">
      <button 
        onClick={onPrev} 
        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center transition-all hover:scale-105 bg-[rgba(40,44,60,0.5)]"
      >
        <ChevronLeft size={18} className="text-gray-400" />
      </button>
      
      <span className="text-xs text-gray-400">
        {currentIdx + 1} / {total}
      </span>

      <button 
        onClick={onNext} 
        className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center transition-all hover:scale-105 bg-[rgba(40,44,60,0.5)]"
      >
        <ChevronRight size={18} className="text-gray-400" />
      </button>
    </div>
  );
}