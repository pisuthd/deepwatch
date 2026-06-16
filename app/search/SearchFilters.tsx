'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

type Category = 'CRYPTO' | 'SPORTS' | 'POLITICS' | 'OTHER';
type MarketType = 'UP_DOWN' | 'RANGE' | 'OTHER';
type Platform = 'DEEPBOOK' | 'POLYMARKET' | 'KALSHI';
interface SearchFilters {
  expiryFrom: string | null;
  expiryTo: string | null;
  marketType: MarketType | 'ALL';
  category: Category | 'ALL';
  subcategory: string | null;
  /** Single-active-source model. We render one platform at a time because
   * the data shapes differ (Polymarket is BinaryMarket[], DeepBook is
   * DeepBookMarket[]). */
  source: Platform;
}

const CATEGORY_OPTIONS: { id: Category | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'CRYPTO', label: 'Crypto' },
];

const SUBCATEGORY_OPTIONS: { id: string; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'Bitcoin', label: 'Bitcoin' },
  { id: 'Ethereum', label: 'Ethereum' },
  { id: 'Solana', label: 'Solana' },
];

const TYPE_OPTIONS: { id: MarketType | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'UP_DOWN', label: 'Up / Down' },
  { id: 'RANGE', label: 'Range' },
];

const ALL_SOURCES: { id: Platform; label: string }[] = [
  { id: 'POLYMARKET', label: 'Polymarket' },
  { id: 'DEEPBOOK', label: 'DeepBook Predict' },
  { id: 'KALSHI', label: 'Kalshi' },
];

const EXPIRY_CHIPS: { id: string; label: string; offsetMs: number }[] = [
  { id: '1h', label: '1h', offsetMs: 60 * 60 * 1000 },
  { id: '4h', label: '4h', offsetMs: 4 * 60 * 60 * 1000 },
  { id: '1d', label: '1d', offsetMs: 24 * 60 * 60 * 1000 },
  { id: '1w', label: '1w', offsetMs: 7 * 24 * 60 * 60 * 1000 },
];

function readFilters(params: URLSearchParams): SearchFilters {
  const sourceParam = params.get('source');
  const source: Platform =
    sourceParam === 'DEEPBOOK' || sourceParam === 'KALSHI' || sourceParam === 'POLYMARKET'
      ? sourceParam
      : 'DEEPBOOK';

  return {
    expiryFrom: params.get('from'),
    expiryTo: params.get('to'),
    marketType: (params.get('type') ?? 'ALL') as MarketType | 'ALL',
    category: (params.get('category') ?? 'ALL') as Category | 'ALL',
    subcategory: params.get('sub'),
    source,
  };
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 16);
}

export default function SearchFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const filters = readFilters(new URLSearchParams(params.toString()));

  const [expiryFrom, setExpiryFrom] = useState<string>(toDateInput(filters.expiryFrom));
  const [expiryTo, setExpiryTo] = useState<string>(toDateInput(filters.expiryTo));
  const [marketType, setMarketType] = useState<MarketType | 'ALL'>(filters.marketType);
  const [category, setCategory] = useState<Category | 'ALL'>(filters.category);
  const [subcategory, setSubcategory] = useState<string>(filters.subcategory ?? 'ALL');
  const [source, setSource] = useState<Platform>(filters.source);

  const push = useCallback(
    (next: Partial<SearchFilters>) => {
      const merged: SearchFilters = {
        expiryFrom: next.expiryFrom !== undefined ? next.expiryFrom : expiryFrom ? new Date(expiryFrom).toISOString() : null,
        expiryTo: next.expiryTo !== undefined ? next.expiryTo : expiryTo ? new Date(expiryTo).toISOString() : null,
        marketType: next.marketType ?? marketType,
        category: next.category ?? category,
        subcategory: next.subcategory !== undefined ? next.subcategory : subcategory,
        source: next.source ?? source,
      };

      const usp = new URLSearchParams();
      usp.set('source', merged.source);
      if (merged.expiryFrom) usp.set('from', merged.expiryFrom);
      if (merged.expiryTo) usp.set('to', merged.expiryTo);
      if (merged.marketType !== 'ALL') usp.set('type', merged.marketType);
      if (merged.category !== 'ALL') usp.set('category', merged.category);
      if (merged.subcategory && merged.subcategory !== 'ALL') usp.set('sub', merged.subcategory);

      router.replace(`/search?${usp.toString()}`);
    },
    [router, expiryFrom, expiryTo, marketType, category, subcategory, source],
  );

  const applyExpiryChip = (offsetMs: number) => {
    const now = new Date();
    const target = new Date(now.getTime() + offsetMs);
    setExpiryFrom(now.toISOString().slice(0, 16));
    setExpiryTo(target.toISOString().slice(0, 16));
    push({
      expiryFrom: now.toISOString(),
      expiryTo: target.toISOString(),
    });
  };

  return (
    <div
      className="rounded-2xl border border-white/10 p-5"
      style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
    >
      <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4">
        Filters
      </h2>

      {/* Expiry */}
      <div className="mb-5">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Expiry
        </label>
        <div className="flex flex-col gap-2">
          <input
            type="datetime-local"
            value={expiryFrom}
            onChange={(e) => {
              setExpiryFrom(e.target.value);
              push({ expiryFrom: e.target.value ? new Date(e.target.value).toISOString() : null });
            }}
            className="bg-[var(--color-bg-elevated)] text-white text-sm rounded-md border border-white/10 px-2 py-1.5 outline-none focus:border-[var(--color-accent-primary)]"
          />
          <span className="text-[10px] text-gray-500 text-center">to</span>
          <input
            type="datetime-local"
            value={expiryTo}
            onChange={(e) => {
              setExpiryTo(e.target.value);
              push({ expiryTo: e.target.value ? new Date(e.target.value).toISOString() : null });
            }}
            className="bg-[var(--color-bg-elevated)] text-white text-sm rounded-md border border-white/10 px-2 py-1.5 outline-none focus:border-[var(--color-accent-primary)]"
          />
        </div>
        <div className="flex flex-wrap gap-1 mt-2">
          {EXPIRY_CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => applyExpiryChip(c.offsetMs)}
              className="text-[10px] px-2 py-1 rounded-md border border-white/10 text-gray-300 hover:border-[var(--color-accent-primary)] hover:text-[var(--color-accent-primary)] transition-colors"
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Market type */}
      <div className="mb-5">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Type
        </label>
        <div className="flex flex-col gap-1.5">
          {TYPE_OPTIONS.map((t) => (
            <label
              key={t.id}
              className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white"
            >
              <input
                type="radio"
                name="marketType"
                value={t.id}
                checked={marketType === t.id}
                onChange={() => {
                  setMarketType(t.id);
                  push({ marketType: t.id });
                }}
                className="accent-[var(--color-accent-primary)]"
              />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      {/* Category */}
      <div className="mb-5">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Category
        </label>
        <div className="flex flex-col gap-1.5">
          {CATEGORY_OPTIONS.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white"
            >
              <input
                type="radio"
                name="category"
                value={c.id}
                checked={category === c.id}
                onChange={() => {
                  setCategory(c.id);
                  push({ category: c.id });
                }}
                className="accent-[var(--color-accent-primary)]"
              />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      {/* Subcategory */}
      <div className="mb-5">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Subcategory
        </label>
        <div className="flex flex-col gap-1.5">
          {SUBCATEGORY_OPTIONS.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white"
            >
              <input
                type="radio"
                name="subcategory"
                value={s.id}
                checked={subcategory === s.id}
                onChange={() => {
                  setSubcategory(s.id);
                  push({ subcategory: s.id });
                }}
                className="accent-[var(--color-accent-primary)]"
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      {/* Source (single-select — one platform at a time) */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Source
        </label>
        <div className="flex flex-col gap-1.5">
          {ALL_SOURCES.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white"
            >
              <input
                type="radio"
                name="source"
                value={s.id}
                checked={source === s.id}
                onChange={() => {
                  setSource(s.id);
                  push({ source: s.id });
                }}
                className="accent-[var(--color-accent-primary)]"
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
