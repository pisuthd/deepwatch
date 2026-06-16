'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Navbar from '@/components/shared/Navbar';
import SearchFilters from './SearchFilters';
import SearchResults from './SearchResults';

type Platform = 'DEEPBOOK' | 'POLYMARKET' | 'KALSHI';

function readSource(params: URLSearchParams): Platform {
  const s = params.get('source');
  return s === 'DEEPBOOK' || s === 'KALSHI' || s === 'POLYMARKET'
    ? s
    : 'DEEPBOOK';
}

function SearchPageInner() {
  const params = useSearchParams();
  const activeSource = readSource(new URLSearchParams(params.toString()));

  return (
    <>
      <Navbar />
      <div className="min-h-screen pt-28 pb-16 px-4 md:px-6">
        <div className="max-w-screen-2xl mx-auto">
          <header className="mb-8">
            <h1 className="text-3xl md:text-4xl font-black mb-2">
              <span className="text-white">Search </span>
              <span className="bg-gradient-to-r from-accent-primary to-blue-400 bg-clip-text text-transparent">
                Results
              </span>
            </h1>
            <p className="text-sm text-gray-400">
              Live odds from Polymarket, DeepBook Predict, and Kalshi. Switch the
              source in the filter panel. Snapshots refresh every minute.
            </p>
          </header>

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
    <Suspense fallback={<div className="min-h-screen pt-28 px-6 text-gray-400">Loading…</div>}>
      <SearchPageInner />
    </Suspense>
  );
}
