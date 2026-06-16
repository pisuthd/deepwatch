'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { ChevronDown } from 'lucide-react';

type MarketType = 'UP_DOWN' | 'RANGE' | 'OTHER';
type Platform = 'DEEPBOOK' | 'POLYMARKET' | 'KALSHI';
type SortOrder = 'expiry_asc' | 'expiry_desc';

interface SearchFilters {
  marketType: MarketType | 'ALL';
  source: Platform;
  sort: SortOrder;
}

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

const SORT_OPTIONS: { id: SortOrder; label: string }[] = [
  { id: 'expiry_asc', label: 'Soonest to expiry' },
  { id: 'expiry_desc', label: 'Latest to expiry' },
];

function readFilters(params: URLSearchParams): SearchFilters {
  const sourceParam = params.get('source');
  const source: Platform =
    sourceParam === 'DEEPBOOK' || sourceParam === 'KALSHI' || sourceParam === 'POLYMARKET'
      ? sourceParam
      : 'DEEPBOOK';
  const sortParam = params.get('sort');
  const sort: SortOrder = sortParam === 'expiry_desc' ? 'expiry_desc' : 'expiry_asc';
  return {
    marketType: (params.get('type') ?? 'ALL') as MarketType | 'ALL',
    source,
    sort,
  };
}

export default function SearchFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const filters = readFilters(new URLSearchParams(params.toString()));

  const [marketType, setMarketType] = useState<MarketType | 'ALL'>(filters.marketType);
  const [source, setSource] = useState<Platform>(filters.source);
  const [sort, setSort] = useState<SortOrder>(filters.sort);

  const push = useCallback(
    (next: Partial<SearchFilters>) => {
      const merged: SearchFilters = {
        marketType: next.marketType ?? marketType,
        source: next.source ?? source,
        sort: next.sort ?? sort,
      };

      // Build the URL: start from the current params (so the top-bar
      // filters like q/from/to/cat/asset survive), then overwrite the
      // sidebar-managed keys.
      const usp = new URLSearchParams(params.toString());
      usp.set('source', merged.source);
      if (merged.marketType === 'ALL') usp.delete('type');
      else usp.set('type', merged.marketType);
      usp.set('sort', merged.sort);

      router.replace(`/search?${usp.toString()}`);
    },
    [router, params, marketType, source, sort],
  );

  return (
    <div
      className="rounded-2xl border border-white/10 p-5 sticky top-28"
      style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
    >
      {/* Source */}
      <div className="mb-5">
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

      {/* Type */}
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

      {/* Sort */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Sort
        </label>
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => {
              const v = e.target.value as SortOrder;
              setSort(v);
              push({ sort: v });
            }}
            className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-2 text-sm text-white appearance-none cursor-pointer outline-none focus:border-[var(--color-accent-primary)]"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.id} value={s.id} className="bg-[var(--color-bg-surface)]">
                {s.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
          />
        </div>
      </div>
    </div>
  );
}
