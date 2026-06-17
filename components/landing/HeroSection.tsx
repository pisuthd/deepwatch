'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import GlassCard from '@/components/shared/GlassCard';

const categories = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'politics', label: 'Politics' },
  { id: 'sports', label: 'Sports' },
  { id: 'tech', label: 'Tech' },
];

const sourceOptions = [
  { id: 'all' as const, label: 'All sources' },
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

const SOURCE_TO_PARAM: Record<SourceId, 'DEEPBOOK' | 'POLYMARKET' | 'KALSHI' | 'ALL'> = {
  all: 'ALL',
  deepbook: 'DEEPBOOK',
  polymarket: 'POLYMARKET',
  kalshi: 'KALSHI',
};

const CATEGORY_TO_PARAM: Record<string, 'ALL' | 'CRYPTO'> = {
  all: 'ALL',
  crypto: 'CRYPTO',
  // politics, sports, tech aren't supported in Phase 1 — fall back to ALL
  politics: 'ALL',
  sports: 'ALL',
  tech: 'ALL',
};

/**
 * Format a Date as `YYYY-MM-DDTHH:MM` for the `<input type="datetime-local">`
 * value and the URL `from` / `to` params. Matches the TopSearchBar's
 * local-time format so the two pickers stay consistent. The search
 * page parses with `new Date(...)` which accepts both this and the
 * `Z`-suffixed ISO string the TopSearchBar sends on submit.
 */
function isoDateTime(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/**
 * "Next hour and round up" — round up to the next whole hour, then
 * if the result would be less than 1 hour from `now`, push it out
 * by one more hour so the user always lands at least 1 hour ahead.
 *
 * Special case for midnight: if rounding up gives 00:00, keep it
 * even if it's less than 1 hour away — the user almost certainly
 * wants "midnight tonight" rather than "1 AM tomorrow morning" for
 * late-evening timestamps.
 *
 * Examples (Bangkok time):
 *   08:15 → 10:00   (09:00 is only 45m away, push to 10:00)
 *   09:00 → 10:00   (10:00 is exactly 1h away, keep)
 *   10:00 → 11:00   (11:00 is exactly 1h away, keep)
 *   10:30 → 12:00   (11:00 is only 30m away, push to 12:00)
 *   14:01 → 16:00   (15:00 is only 59m away, push to 16:00)
 *   23:30 → 00:00   (midnight, kept as the natural next-hour boundary)
 */
function nextHourRoundedUp(now: Date): Date {
  const d = new Date(now);
  // Step 1: round up to the next whole hour.
  d.setHours(d.getHours() + 1, 0, 0, 0);
  // Step 2: if the result is less than 1 hour from `now`, push by 1h.
  // Special case: midnight (00:00) is kept even if it's < 1h away.
  if (d.getTime() - now.getTime() < 60 * 60 * 1000) {
    if (d.getHours() === 0) {
      return d; // midnight — keep
    }
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return d;
}

export default function HeroSection() {
  const router = useRouter();

  // Default from = the next whole hour, at least 1h away (or midnight).
  // Default to = 30 days from that.
  const initialFrom = useMemo(() => {
    return isoDateTime(nextHourRoundedUp(new Date()));
  }, []);
  const initialTo = useMemo(() => {
    const d = nextHourRoundedUp(new Date());
    d.setDate(d.getDate() + 30);
    return isoDateTime(d);
  }, []);

  const [fromDate, setFromDate] = useState(initialFrom);
  const [toDate, setToDate] = useState(initialTo);
  const [category, setCategory] = useState('all');
  // Default to "All sources" — the hero advertises the unified view.
  const [activeSource, setActiveSource] = useState<SourceId>('all');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const usp = new URLSearchParams();
    usp.set('source', SOURCE_TO_PARAM[activeSource]);
    // Send the full datetime (matches TopSearchBar's `Z`-suffixed ISO
    // string on submit). The search page's `readExpiryBounds` parses
    // both formats via `new Date(...)`.
    usp.set('from', new Date(fromDate).toISOString());
    usp.set('to', new Date(toDate).toISOString());
    usp.set('category', CATEGORY_TO_PARAM[category] ?? 'ALL');

    router.push(`/search?${usp.toString()}`);
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
          Compare Polymarket, DeepBook Predict, and Kalshi side by side. Pick a
          source, filter by expiry or type, and find the highest-conviction
          market.
        </motion.p>

        {/* Search Form (Skyscanner-style multi-field card) — wrapped in GlassCard */}
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          onSubmit={handleSubmit}
          className="mb-6"
        >
          <GlassCard>
            <div className="flex flex-col md:flex-row md:items-stretch gap-2 md:gap-0">
              {/* From date+time */}
              <label className="flex flex-col text-left flex-1 px-3 py-2 md:border-r md:border-white/10">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  From
                </span>
                <input
                  type="datetime-local"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="bg-transparent text-white outline-none w-full text-sm [color-scheme:dark]"
                />
              </label>

              {/* To date+time */}
              <label className="flex flex-col text-left flex-1 px-3 py-2 md:border-r md:border-white/10">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  To
                </span>
                <input
                  type="datetime-local"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="bg-transparent text-white outline-none w-full text-sm [color-scheme:dark]"
                />
              </label>

              {/* Category (kept for layout parity with the top bar;
                  not wired through to the search page beyond the
                  stub `category` param the user said isn't needed). */}
              <label className="flex flex-col text-left md:w-44 px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Category
                </span>
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
              </label>

              {/* Search button */}
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent-primary text-black font-semibold hover:bg-accent-primary-hover transition-all text-sm"
              >
                Search
                <ArrowRight size={16} />
              </button>
            </div>

            {/* Source row — single-select radio, with "All sources" at the top */}
            <div className="flex flex-wrap items-center gap-3 md:gap-4 px-3 pt-3 mt-2 border-t border-white/10">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Source
              </span>
              {sourceOptions.map((s) => (
                <label
                  key={s.id}
                  className="inline-flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white transition-colors"
                >
                  <input
                    type="radio"
                    name="source"
                    checked={activeSource === s.id}
                    onChange={() => setActiveSource(s.id)}
                    className="w-4 h-4 border-white/20 bg-transparent accent-[var(--color-accent-primary)] cursor-pointer"
                  />
                  {s.label}
                </label>
              ))}
            </div>
          </GlassCard>
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
                // onClick={() => setMarket(t)}
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
