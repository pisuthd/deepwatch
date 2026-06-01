'use client';

import { useState, useEffect } from 'react';
import PageWrapper from '../common/PageWrapper';
import {   ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../context/ThemeContext';

const mockMarkets = [
  { id: 1, name: 'BTC', basePrice: 71400, expiry: '4h' },
  { id: 2, name: 'ETH', basePrice: 3500, expiry: '2h' },
  { id: 3, name: 'SOL', basePrice: 180, expiry: '3h' },
];

const generateStrikes = () => {
  return [
    { offset: -1000, direction: 'down' },
    { offset: -500, direction: 'down' },
    { offset: 0, direction: 'spot' },
    { offset: 500, direction: 'up' },
    { offset: 1000, direction: 'up' },
  ];
};

const GlassButton = ({ children, variant = 'green', className = '' }: { children: React.ReactNode; variant?: 'green' | 'red'; className?: string }) => {
  const { isDark } = useTheme();
  const bgColor = variant === 'green' ? '#00E68A' : '#ef4444';
  
  return (
    <div 
      className={`relative rounded-xl px-4 py-2.5 ${isDark ? 'border border-white/10' : 'border border-black/5 shadow-sm'} ${className}`}
      style={{ 
        background: isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className={`absolute inset-0 rounded-xl ${isDark ? 'bg-gradient-to-br from-white/5 to-transparent' : 'bg-gradient-to-br from-white/60 to-transparent'}`} />
      <div className={`absolute top-0 left-0 w-full h-px ${isDark ? 'bg-gradient-to-r from-transparent via-white/10 to-transparent' : 'bg-gradient-to-r from-transparent via-black/5 to-transparent'}`} />
      <div className="absolute -top-4 -right-4 w-12 h-12 rounded-full" style={{ background: bgColor, filter: 'blur(30px)', opacity: isDark ? 0.15 : 0.08 }} />
      <div className="relative z-10 flex items-center gap-1.5 text-sm font-semibold" style={{ color: bgColor }}>
        {children}
      </div>
    </div>
  );
};

export default function MarketsPage() {
  const { isDark } = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedStrike, setSelectedStrike] = useState(2);

  const market = mockMarkets[currentIdx];
  const strikes = generateStrikes();
  const selectedPrice = market.basePrice + strikes[selectedStrike].offset;
  const question = `Will ${market.name} be above/below $${selectedPrice.toLocaleString()}?`;

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 3500);
    return () => clearTimeout(t);
  }, []);

  const prev = () => {
    setCurrentIdx((i) => (i === 0 ? mockMarkets.length - 1 : i - 1));
    setSelectedStrike(2);
  };

  const next = () => {
    setCurrentIdx((i) => (i === mockMarkets.length - 1 ? 0 : i + 1));
    setSelectedStrike(2);
  };

  const getOdds = (i: number) => {
    const up = 0.3 + (i * 0.07) + Math.random() * 0.15;
    return { up: up.toFixed(2), down: (1 - up + 0.08).toFixed(2) };
  };

  const green = '#00E68A';
  const textPrimary = isDark ? '#ffffff' : '#111827';
  const textSecondary = isDark ? '#9ca3af' : '#71717a';

  return (
    <PageWrapper title="Markets">
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-sm" style={{ color: textSecondary }}>
            <Loader2 size={20} className="animate-spin" style={{ color: green }} />
            Loading markets...
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-4">
          <button onClick={prev} className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center transition-all hover:scale-105" style={{ background: isDark ? 'rgba(40, 44, 60, 0.5)' : 'rgba(248, 249, 250, 0.9)' }}>
            <ChevronLeft size={18} style={{ color: textSecondary }} />
          </button>

          <div className="w-full max-w-md space-y-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${market.id}-info`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                {/* Question Card */}
                <div className={`relative overflow-hidden rounded-2xl p-5 ${isDark ? 'border border-white/10' : 'border border-black/5 shadow-lg'}`} style={{ background: isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(20px)' }}>
                  <div className={`absolute inset-0 rounded-2xl ${isDark ? 'bg-gradient-to-br from-white/5 to-transparent' : 'bg-gradient-to-br from-white/80 to-transparent'}`} />
                  <div className={`absolute top-0 left-0 w-full h-px ${isDark ? 'bg-gradient-to-r from-transparent via-white/20 to-transparent' : 'bg-gradient-to-r from-transparent via-black/10 to-transparent'}`} />
                  <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full" style={{ background: green, filter: 'blur(80px)', opacity: isDark ? 0.15 : 0.1 }} />
                  
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-lg font-bold" style={{ color: textPrimary }}>{question}</h2>
                      <span className="text-xs px-2 py-1 rounded" style={{ background: isDark ? 'rgba(40, 44, 60, 0.5)' : 'rgba(248, 249, 250, 0.9)', color: textSecondary }}>
                        {market.expiry}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold" style={{ color: green }}>${market.basePrice.toLocaleString()}</span>
                      <span className="text-sm" style={{ color: textSecondary }}>{market.name}/USD</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Strike Rows */}
            <div className="max-h-[450px] overflow-y-auto pr-1">
              {strikes.map((strike, i) => {
                const price = market.basePrice + strike.offset;
                const isSelected = i === selectedStrike;
                
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedStrike(i)}
                    className="w-full flex items-center justify-between rounded-xl px-3 py-2 mb-1 transition-all"
                    style={{ background: 'transparent' }}
                  >
                    <span className="text-base font-semibold" style={{ color: isSelected ? green : textPrimary }}>
                      ${price.toLocaleString()}
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); alert(`UP: $${price.toLocaleString()} at ${getOdds(i).up}`); }}
                        className={`relative rounded-2xl px-4 py-2.5 overflow-hidden ${isDark ? 'border border-white/10' : 'border border-black/5 shadow-lg'}`}
                        style={{ background: isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(20px)' }}
                      >
                        <div className={`absolute inset-0 rounded-2xl ${isDark ? 'bg-gradient-to-br from-white/5 to-transparent' : 'bg-gradient-to-br from-white/80 to-transparent'}`} />
                        <div className={`absolute top-0 left-0 w-full h-px ${isDark ? 'bg-gradient-to-r from-transparent via-white/20 to-transparent' : 'bg-gradient-to-r from-transparent via-black/10 to-transparent'}`} />
                        <div className="absolute -top-4 -right-4 w-12 h-12 rounded-full" style={{ background: green, filter: 'blur(30px)', opacity: isDark ? 0.15 : 0.08 }} />
                        <span className="relative z-10 text-sm font-semibold" style={{ color: green }}>▲ UP {getOdds(i).up}</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); alert(`DOWN: $${price.toLocaleString()} at ${getOdds(i).down}`); }}
                        className={`relative rounded-2xl px-4 py-2.5 overflow-hidden ${isDark ? 'border border-white/10' : 'border border-black/5 shadow-lg'}`}
                        style={{ background: isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)', backdropFilter: 'blur(20px)' }}
                      >
                        <div className={`absolute inset-0 rounded-2xl ${isDark ? 'bg-gradient-to-br from-white/5 to-transparent' : 'bg-gradient-to-br from-white/80 to-transparent'}`} />
                        <div className={`absolute top-0 left-0 w-full h-px ${isDark ? 'bg-gradient-to-r from-transparent via-white/20 to-transparent' : 'bg-gradient-to-r from-transparent via-black/10 to-transparent'}`} />
                        <div className="absolute -top-4 -right-4 w-12 h-12 rounded-full" style={{ background: '#ef4444', filter: 'blur(30px)', opacity: isDark ? 0.15 : 0.08 }} />
                        <span className="relative z-10 text-sm font-semibold" style={{ color: '#ef4444' }}>▼ DOWN {getOdds(i).down}</span>
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="text-center text-xs" style={{ color: textSecondary }}>
              {currentIdx + 1} / {mockMarkets.length}
            </div>
          </div>

          <button onClick={next} className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center transition-all hover:scale-105" style={{ background: isDark ? 'rgba(40, 44, 60, 0.5)' : 'rgba(248, 249, 250, 0.9)' }}>
            <ChevronRight size={18} style={{ color: textSecondary }} />
          </button>
        </div>
      )}
    </PageWrapper>
  );
}