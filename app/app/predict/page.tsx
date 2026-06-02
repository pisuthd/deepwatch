'use client';

import { useState, useEffect } from 'react';
import PageWrapper from '../../components/common/PageWrapper';
import { Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import PredictHeader from '../../components/pages/predict/PredictHeader';
import StrikeRow from '../../components/pages/predict/StrikeRow';
import MarketCarousel from '../../components/pages/predict/MarketCarousel';

const mockMarkets = [
  { id: 1, name: 'BTC', basePrice: 71400, expiry: '4h' },
  { id: 2, name: 'ETH', basePrice: 3500, expiry: '2h' },
  { id: 3, name: 'SOL', basePrice: 180, expiry: '3h' },
];

const strikes = [
  { offset: -1000 },
  { offset: -500 },
  { offset: 0 },
  { offset: 500 },
  { offset: 1000 },
];

export default function PredictPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);

  const market = mockMarkets[currentIdx];
  const selectedPrice = market.basePrice + strikes[2].offset;
  const question = `Will ${market.name} be above/below $${selectedPrice.toLocaleString()}?`;

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 3500);
    return () => clearTimeout(t);
  }, []);

  const prev = () => {
    setCurrentIdx((i) => (i === 0 ? mockMarkets.length - 1 : i - 1));
  };

  const next = () => {
    setCurrentIdx((i) => (i === mockMarkets.length - 1 ? 0 : i + 1));
  };

  const getOdds = (i: number) => {
    const up = 0.3 + (i * 0.07) + Math.random() * 0.15;
    return { up: up.toFixed(2), down: (1 - up + 0.08).toFixed(2) };
  };

  return (
    <PageWrapper title="Predict">
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <Loader2 size={20} className="animate-spin text-[#00E68A]" />
            Loading markets...
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="w-full max-w-md">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${market.id}-info`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <PredictHeader
                  question={question}
                  spotPrice={market.basePrice}
                  marketName={market.name}
                  expiry={market.expiry}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="w-full max-w-md max-h-[400px] overflow-y-auto pr-1">
            {strikes.map((strike, i) => {
              const price = market.basePrice + strike.offset;
              const odds = getOdds(i);
              
              return (
                <StrikeRow
                  key={i}
                  price={price}
                  upOdds={odds.up}
                  downOdds={odds.down}
                  onUp={() => alert(`UP: $${price.toLocaleString()} at ${odds.up}`)}
                  onDown={() => alert(`DOWN: $${price.toLocaleString()} at ${odds.down}`)}
                />
              );
            })}
          </div>

          <MarketCarousel
            currentIdx={currentIdx}
            total={mockMarkets.length}
            onPrev={prev}
            onNext={next}
          />
        </div>
      )}
    </PageWrapper>
  );
}