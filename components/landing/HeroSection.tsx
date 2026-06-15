'use client';

import { motion } from 'framer-motion';
import { Search, ChevronDown, ArrowRight } from 'lucide-react';
import { useState, useEffect } from 'react';

const categories = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'politics', label: 'Politics' },
  { id: 'sports', label: 'Sports' },
  { id: 'tech', label: 'Tech' },
];

const sourceOptions = [
  { id: 'deepbook' as const, label: 'DeepBook Predict' },
  { id: 'polymarket' as const, label: 'Polymarket' },
  { id: 'kalshi' as const, label: 'Kalshi' },
];

type SourceId = (typeof sourceOptions)[number]['id'];

const trending = [
  'BTC > $100k by EOY',
  'Fed rate cut Q1',
  'Trump 2024',
  'ETH > $5k',
  'Solana flips ETH',
];

export default function HeroSection() {
  const [market, setMarket] = useState('');
  const [category, setCategory] = useState('all');
  const [enabledSources, setEnabledSources] = useState<Record<SourceId, boolean>>({
    deepbook: true,
    polymarket: true,
    kalshi: true,
  });

  const toggleSource = (id: SourceId) => {
    setEnabledSources((s) => ({ ...s, [id]: !s[id] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Wire to real search results route once the app is built out
    window.location.href = '/app';
  };

  const [showScrollIndicator, setShowScrollIndicator] = useState(true);

  useEffect(() => {
    const onScroll = () => {
      setShowScrollIndicator(window.scrollY < 100);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <section className="relative flex items-center justify-center overflow-hidden pt-32 md:pt-24 pb-4 md:pb-24 px-6">
      <div className="relative z-10 max-w-4xl mx-auto w-full text-center">
        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-4xl md:text-5xl lg:text-6xl font-black mb-4 lg:mb-6 leading-tight"
        >
          <span className="text-white">Find the </span>
          <span className="bg-gradient-to-r from-accent-primary to-blue-400 bg-clip-text text-transparent">
            Best Odds
          </span>{` `}
          <span className="text-white">Across Prediction Markets</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-base sm:text-lg text-gray-400 mb-8 max-w-2xl mx-auto leading-relaxed"
        >
          Compare DeepBook Predict, Polymarket, and Kalshi side by side. Spot pricing gaps, uncover opportunities, and trade with confidence.
        </motion.p>

        {/* Search Form (Skyscanner-style multi-field card) */}
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 p-2 md:p-3 mb-6"
          style={{
            background: 'rgba(26, 29, 46, 0.6)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="flex flex-col md:flex-row md:items-stretch gap-2 md:gap-0">
            {/* Market search */}
            <label className="flex flex-col text-left flex-1 px-3 py-2 md:border-r md:border-white/10">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Market
              </span>
              <div className="flex items-center gap-2">
                <Search size={16} className="text-gray-500 shrink-0" />
                <input
                  type="text"
                  value={market}
                  onChange={(e) => setMarket(e.target.value)}
                  placeholder="e.g. BTC > 100k by EOY"
                  className="bg-transparent text-white placeholder:text-gray-500 outline-none w-full text-sm"
                />
              </div>
            </label>

            {/* Category */}
            <label className="flex flex-col text-left md:w-44 px-3 py-2 md:border-r md:border-white/10">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Category
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="bg-transparent text-white outline-none w-full text-sm appearance-none cursor-pointer"
                >
                  {categories.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      className="bg-[var(--color-bg-surface)]"
                    >
                      {c.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="text-gray-500 shrink-0 pointer-events-none"
                />
              </div>
            </label>

            {/* Compare button */}
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent-primary text-black font-semibold hover:bg-accent-primary-hover transition-all text-sm"
            >
              Search
              <ArrowRight size={16} />
            </button>
          </div>

          {/* Sources row */}
          <div className="flex flex-wrap items-center gap-3 md:gap-4 px-3 pt-3 mt-2 border-t border-white/10">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Sources
            </span>
            {sourceOptions.map((s) => (
              <label
                key={s.id}
                className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white transition-colors"
              >
                <input
                  type="checkbox"
                  checked={enabledSources[s.id]}
                  onChange={() => toggleSource(s.id)}
                  className="w-4 h-4 rounded border-white/20 bg-transparent accent-[var(--color-accent-primary)] cursor-pointer"
                />
                {s.label}
              </label>
            ))}
          </div>
        </motion.form>

        {/* Trending row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="text-sm text-gray-400"
        >
          <span className="text-gray-500 mr-2">Trending:</span>
          {trending.map((t, i) => (
            <span key={t}>
              <button
                type="button"
                onClick={() => setMarket(t)}
                className="text-gray-300 hover:text-accent-primary transition-colors"
              >
                {t}
              </button>
              {i < trending.length - 1 && (
                <span className="text-gray-600 mx-1.5">•</span>
              )}
            </span>
          ))}
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: showScrollIndicator ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        className="absolute bottom-4 lg:bottom-8 left-1/2 -translate-x-1/2"
      >
        <div className="w-5 h-8 rounded-full border border-gray-600 flex justify-center pt-1">
          <motion.div
            animate={{ y: [0, 4, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-1 h-1 rounded-full bg-gray-500"
          />
        </div>
      </motion.div>
    </section>
  );
}
