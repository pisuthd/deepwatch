'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Navbar from '@/components/shared/Navbar';
import TopSearchBar from './TopSearchBar';
import SearchFilters from './SearchFilters';
import SearchResults from './SearchResults';

type Platform = 'DEEPBOOK' | 'POLYMARKET' | 'KALSHI' | 'ALL';

function readSource(params: URLSearchParams): Platform {
  const s = params.get('source');
  if (s === 'DEEPBOOK' || s === 'KALSHI' || s === 'POLYMARKET' || s === 'ALL') {
    return s;
  }
  return 'ALL';
}

function SearchPageInner() {
  const params = useSearchParams();
  const activeSource = readSource(new URLSearchParams(params.toString()));

  return (
    <>
      <Navbar />

      {/* Top search bar — full width with a divider underneath */}
      <div className="pt-24 px-4 md:px-6 border-b border-white/10 pb-4">
        <TopSearchBar />
      </div>

      {/* Below: sidebar + main, centered with max-w */}
      <div className="px-4 md:px-6 pt-6 pb-16">
        <div className="max-w-screen-2xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
            <aside>
              <SearchFilters />
            </aside>
            <main>
              <SearchResults activeSource={activeSource} />
            </main>
          </div>
        </div>
      </div>
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen pt-24 px-6 text-gray-400">Loading…</div>}>
      <SearchPageInner />
    </Suspense>
  );
}
