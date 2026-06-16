'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useCallback } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

// Category options — matches HeroSection. Phase 1 only supports ALL + CRYPTO;
// politics/sports/tech fall back to ALL via CATEGORY_TO_PARAM.
const CATEGORY_OPTIONS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'politics', label: 'Politics' },
  { id: 'sports', label: 'Sports' },
  { id: 'tech', label: 'Tech' },
];

const CATEGORY_TO_PARAM: Record<string, 'ALL' | 'CRYPTO'> = {
  all: 'ALL',
  crypto: 'CRYPTO',
  // politics, sports, tech aren't supported in Phase 1 — fall back to ALL
  politics: 'ALL',
  sports: 'ALL',
  tech: 'ALL',
};

const SUBCATEGORY_OPTIONS: { id: string; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'Bitcoin', label: 'Bitcoin' },
  { id: 'Ethereum', label: 'Ethereum' },
  { id: 'Solana', label: 'Solana' },
];

/** "Expiring within" dropdown options. ALL clears from/to; the rest
 *  set from = now, to = now + offsetMs. */
const EXPIRY_OPTIONS: { id: string; label: string; offsetMs: number | null }[] = [
  { id: 'ALL', label: 'All', offsetMs: null },
  { id: '1h', label: '1 hour', offsetMs: 60 * 60 * 1000 },
  { id: '4h', label: '4 hours', offsetMs: 4 * 60 * 60 * 1000 },
  { id: '1d', label: '1 day', offsetMs: 24 * 60 * 60 * 1000 },
  { id: '1w', label: '1 week', offsetMs: 7 * 24 * 60 * 60 * 1000 },
];

/** A single grid cell. Label on top, content below. */
function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 flex flex-col">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div className="flex items-center gap-2 mt-1">{children}</div>
    </div>
  );
}

export default function TopSearchBar() {
  const router = useRouter();
  const params = useSearchParams();

  const [dateFrom, setDateFrom] = useState<string>(
    params.get('from')
      ? new Date(params.get('from')!).toISOString().slice(0, 16)
      : '',
  );
  const [dateTo, setDateTo] = useState<string>(
    params.get('to')
      ? new Date(params.get('to')!).toISOString().slice(0, 16)
      : '',
  );
  // Category state holds the option id (e.g. 'all', 'crypto'). The URL
  // uses the mapped value (ALL or CRYPTO).
  const initialCategoryId = (() => {
    const urlCategory = params.get('category');
    if (!urlCategory || urlCategory === 'ALL') return 'all';
    if (urlCategory === 'CRYPTO') return 'crypto';
    return 'all';
  })();
  const [category, setCategory] = useState<string>(initialCategoryId);
  const [subcategory, setSubcategory] = useState<string>(
    params.get('sub') ?? 'ALL',
  );
  // Expiry window dropdown — default ALL (no filter).
  const [expiryWindow, setExpiryWindow] = useState<string>('ALL');

  /** Build a URL that preserves the sidebar-managed params (source,
   *  sort, type) and applies the current top-bar state. Used by the
   *  form's Enter-key submit. */
  const buildUrl = useCallback(() => {
    const usp = new URLSearchParams();
    const existingSource = params.get('source');
    if (existingSource) usp.set('source', existingSource);
    const existingSort = params.get('sort');
    if (existingSort) usp.set('sort', existingSort);
    const existingType = params.get('type');
    if (existingType) usp.set('type', existingType);
    const mappedCategory = CATEGORY_TO_PARAM[category] ?? 'ALL';
    if (mappedCategory !== 'ALL') usp.set('category', mappedCategory);
    if (subcategory !== 'ALL') usp.set('sub', subcategory);
    if (dateFrom) usp.set('from', new Date(dateFrom).toISOString());
    if (dateTo) usp.set('to', new Date(dateTo).toISOString());
    return usp.toString();
  }, [params, category, subcategory, dateFrom, dateTo]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      router.push(`/search?${buildUrl()}`);
    },
    [router, buildUrl],
  );

  /** Apply the "Expiring within" dropdown: set from/to on the URL
   *  immediately, and sync the local date inputs so the From/To
   *  cells stay in sync. */
  const applyExpiryWindow = useCallback(
    (window: string) => {
      setExpiryWindow(window);
      const usp = new URLSearchParams();
      const existingSource = params.get('source');
      if (existingSource) usp.set('source', existingSource);
      const existingSort = params.get('sort');
      if (existingSort) usp.set('sort', existingSort);
      const existingType = params.get('type');
      if (existingType) usp.set('type', existingType);
      const mappedCategory = CATEGORY_TO_PARAM[category] ?? 'ALL';
      if (mappedCategory !== 'ALL') usp.set('category', mappedCategory);
      if (subcategory !== 'ALL') usp.set('sub', subcategory);

      if (window === 'ALL') {
        // Clear from/to
        setDateFrom('');
        setDateTo('');
      } else {
        const opt = EXPIRY_OPTIONS.find((o) => o.id === window);
        if (opt && opt.offsetMs !== null) {
          const now = new Date();
          const target = new Date(now.getTime() + opt.offsetMs);
          const fromIso = now.toISOString();
          const toIso = target.toISOString();
          usp.set('from', fromIso);
          usp.set('to', toIso);
          // Sync the local date inputs
          setDateFrom(fromIso.slice(0, 16));
          setDateTo(toIso.slice(0, 16));
        }
      }
      router.push(`/search?${usp.toString()}`);
    },
    [router, params, category, subcategory],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-white/10 rounded-xl overflow-hidden"
    >
      <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-white/10">
        {/* From */}
        <Cell label="From">
          <Calendar size={16} className="text-gray-500 shrink-0" />
          <input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-transparent text-white outline-none w-full text-sm [color-scheme:dark]"
          />
        </Cell>

        {/* To */}
        <Cell label="To">
          <Calendar size={16} className="text-gray-500 shrink-0" />
          <input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-transparent text-white outline-none w-full text-sm [color-scheme:dark]"
          />
        </Cell>

        {/* Category */}
        <Cell label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-transparent text-white outline-none w-full text-sm appearance-none cursor-pointer"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.id} value={c.id} className="bg-[var(--color-bg-surface)]">
                {c.label}
              </option>
            ))}
          </select>
          <ChevronDown size={16} className="text-gray-500 shrink-0 pointer-events-none" />
        </Cell>

        {/* Sub-category (was Asset) */}
        <Cell label="Sub-category">
          <select
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            className="bg-transparent text-white outline-none w-full text-sm appearance-none cursor-pointer"
          >
            {SUBCATEGORY_OPTIONS.map((s) => (
              <option key={s.id} value={s.id} className="bg-[var(--color-bg-surface)]">
                {s.label}
              </option>
            ))}
          </select>
          <ChevronDown size={16} className="text-gray-500 shrink-0 pointer-events-none" />
        </Cell>

        {/* Expiring within (replaces Search button) */}
        <Cell label="Expiring within">
          <select
            value={expiryWindow}
            onChange={(e) => applyExpiryWindow(e.target.value)}
            className="bg-transparent text-white outline-none w-full text-sm appearance-none cursor-pointer"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id} className="bg-[var(--color-bg-surface)]">
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown size={16} className="text-gray-500 shrink-0 pointer-events-none" />
        </Cell>
      </div>
    </form>
  );
}
