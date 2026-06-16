'use client';

import { useMemo } from 'react';
import UpDownCard from '@/components/search/UpDownCard';
import RangeCard from '@/components/search/RangeCard';
import {
  groupDeepBookMarkets,
  type DeepBookGroup,
} from '@/lib/markets/deepbook';
import {
  groupPolymarketMarkets,
  type PolymarketGroup,
} from '@/lib/markets/polymarket';
import {
  groupKalshiMarkets,
  type KalshiGroup,
} from '@/lib/markets/kalshi';
import { useMarkets } from '@/stores/markets-store';
import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

type Platform = 'DEEPBOOK' | 'POLYMARKET' | 'KALSHI' | 'ALL';

interface Props {
  activeSource: Platform;
}

// Eyebrow node per platform. Each card picks its eyebrow from the
// `Entry.source` field (not the page-level `activeSource`), so the
// "All sources" view can mix Polymarket/DeepBook/Kalshi cards each
// with their own source label. The `ALL` entry is a fallback that
// shouldn't actually render — every entry has a concrete source.
const PLATFORM_EYEBROW: Record<Platform, ReactNode> = {
  POLYMARKET: (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
      Polymarket
    </div>
  ),
  DEEPBOOK: (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
      DeepBook Predict
    </div>
  ),
  KALSHI: (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
      Kalshi
    </div>
  ),
  ALL: (
    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
      All sources
    </div>
  ),
};

type UpDownRow = {
  strikeUsd: number;
  impliedProbUp: number;
  description: string | null;
  priceToBeatUsd: number | null;
};
type RangeRow = {
  floorStrikeUsd: number;
  capStrikeUsd: number;
  rangeBandPct: number;
  impliedProbUp: number;
  description: string | null;
};

interface CardProps {
  asset: string;
  spotUsd: number | null;
  forwardUsd: number | null;
  expiryMs: number;
  question: string | null;
  eyebrow: ReactNode;
}

type Entry =
  | { kind: 'upDown'; key: string; expiryMs: number; question: string | null; rows: UpDownRow[]; source: Exclude<Platform, 'ALL'> }
  | { kind: 'range'; key: string; expiryMs: number; question: string | null; rows: RangeRow[]; source: Exclude<Platform, 'ALL'> };

type SortOrder = 'expiry_asc' | 'expiry_desc';

/**
 * Renders the entries as a 2-column grid. Entries are paired into
 * rows of 2; each row (except the last) gets a full-width horizontal
 * divider that spans both columns. The cards themselves use the
 * original GlassCard variants.
 */
function renderEntries(entries: Entry[]) {
  if (entries.length === 0) return null;

  // Group entries into rows of 2. If the last row has only 1 entry,
  // it still renders (one card on the left, empty on the right).
  const rows: Entry[][] = [];
  for (let i = 0; i < entries.length; i += 2) {
    rows.push(entries.slice(i, i + 2));
  }

  return (
    <div>
      {rows.map((row, i) => {
        const isLastRow = i === rows.length - 1;
        return (
          <div
            key={`row-${i}`}
            className={
              isLastRow
                ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
                : 'grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-white/10 pb-4 mb-4'
            }
          >
            {row.map((e) => {
              // Card props common to all sources. Eyebrow is per-entry
              // (not page-level), so the "All sources" view renders
              // each card with its own source label.
              const cardProps: CardProps = {
                asset: 'BTC',
                spotUsd: null,
                forwardUsd: null,
                expiryMs: e.expiryMs,
                question: e.question,
                eyebrow: PLATFORM_EYEBROW[e.source],
              };
              return (
                <div key={e.key}>
                  {e.kind === 'upDown' ? (
                    <UpDownCard {...cardProps} rows={e.rows} />
                  ) : (
                    <RangeCard {...cardProps} rows={e.rows} />
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function readSort(params: URLSearchParams): SortOrder {
  return params.get('sort') === 'expiry_desc' ? 'expiry_desc' : 'expiry_asc';
}

/**
 * Read the `from` / `to` URL params and return them as millisecond
 * timestamps. Both inputs can be either:
 *   - Date-only: `YYYY-MM-DD` (date-only inputs extend to end-of-day
 *     so a market expiring on the chosen day is still included)
 *   - Date+time: `YYYY-MM-DDTHH:MM` or `…Z` (datetime inputs use the
 *     exact timestamp — no extension)
 *
 * The hero and the TopSearchBar both send datetime strings, so the
 * extension only kicks in for date-only params.
 */
function readExpiryBounds(params: URLSearchParams): {
  fromMs: number | null;
  toMs: number | null;
} {
  const fromParam = params.get('from');
  const toParam = params.get('to');
  const fromMs = fromParam ? new Date(fromParam).getTime() : null;
  const fromOk = fromMs != null && Number.isFinite(fromMs) ? fromMs : null;
  // Only extend to end-of-day for date-only inputs (no 'T' in the
  // string). Datetime inputs are already at the precise hour, so
  // adding 24h would shift the window a full day forward.
  const toIsDateOnly = toParam ? !toParam.includes('T') : false;
  const toBase = toParam ? new Date(toParam).getTime() : null;
  const toOk = toBase != null && Number.isFinite(toBase)
    ? toIsDateOnly
      ? toBase + 24 * 60 * 60 * 1000 - 1
      : toBase
    : null;
  return { fromMs: fromOk, toMs: toOk };
}

/**
 * Filter rows by expiry. Returns the input unchanged if no bounds.
 * `expiryMs` may be `number | null` (matches `BinaryMarket`); rows with
 * a null expiry are always included — the fetchers set null only for
 * markets we couldn't parse a date for, and those should still surface.
 */
function filterByExpiry<
  T extends { expiryMs: number | null },
>(rows: T[], fromMs: number | null, toMs: number | null): T[] {
  if (fromMs == null && toMs == null) return rows;
  return rows.filter((r) => {
    if (r.expiryMs == null) return true;
    if (fromMs != null && r.expiryMs < fromMs) return false;
    if (toMs != null && r.expiryMs > toMs) return false;
    return true;
  });
}

export default function SearchResults({ activeSource }: Props) {
  const params = useSearchParams();
  const sort = readSort(new URLSearchParams(params.toString()));
  const { fromMs, toMs } = readExpiryBounds(new URLSearchParams(params.toString()));

  // Pull live data from the global store. No local fetch, no
  // useEffect, no AbortController — the store handles all of that.
  const {
    polyRows,
    dbRows,
    kalshiRows,
    polyError,
    dbError,
    kalshiError,
    firstLoad,
  } = useMarkets();

  // Per-source loading flags.
  const { polyLoading, dbLoading, kalshiLoading } = useMarkets();

  // Apply the from/to expiry filter to the raw rows before grouping.
  // Grouping lives in the lib and stays source-agnostic; the filter
  // is a view concern.
  const filteredPolyRows = useMemo(
    () => filterByExpiry(polyRows ?? [], fromMs, toMs),
    [polyRows, fromMs, toMs],
  );
  const filteredDbRows = useMemo(
    () => filterByExpiry(dbRows ?? [], fromMs, toMs),
    [dbRows, fromMs, toMs],
  );
  const filteredKalshiRows = useMemo(
    () => filterByExpiry(kalshiRows ?? [], fromMs, toMs),
    [kalshiRows, fromMs, toMs],
  );

  // Grouping lives in the lib; SearchResults is a pure view layer.
  const polyGroups = useMemo<PolymarketGroup[]>(
    () => (filteredPolyRows.length > 0 ? groupPolymarketMarkets(filteredPolyRows) : []),
    [filteredPolyRows],
  );
  const dbGroups = useMemo<DeepBookGroup[]>(
    () => (filteredDbRows.length > 0 ? (groupDeepBookMarkets(filteredDbRows) as DeepBookGroup[]) : []),
    [filteredDbRows],
  );
  const kalshiGroups = useMemo<KalshiGroup[]>(
    () => (filteredKalshiRows.length > 0 ? groupKalshiMarkets(filteredKalshiRows) : []),
    [filteredKalshiRows],
  );

  // Loading / error: when source is ALL, show if ANY source is loading
  // or errored. Per-source radios show only that source's state.
  const loading =
    activeSource === 'ALL'
      ? (polyLoading || dbLoading || kalshiLoading)
      : activeSource === 'POLYMARKET'
        ? polyLoading
        : activeSource === 'KALSHI'
          ? kalshiLoading
          : dbLoading;
  const error =
    activeSource === 'ALL'
      ? (polyError || dbError || kalshiError)
      : activeSource === 'POLYMARKET'
        ? polyError
        : activeSource === 'KALSHI'
          ? kalshiError
          : dbError;

  // Normalize each source's groups to a common shape, carrying both
  // the per-group question (Polymarket/Kalshi) and per-row description
  // (Polymarket/Kalshi) from the API. DeepBook groups carry null
  // question + null description — its cards fall back to the generated
  // text. Each group also carries its `source` so the entry can pick
  // the right eyebrow. Kalshi's `KalshiGroup.upDown` rows don't carry
  // `priceToBeatUsd` (a Polymarket-only field), so we fill it with
  // null in the mapping.
  type CommonGroup = {
    key: string;
    expiryMs: number;
    question: string | null;
    source: Exclude<Platform, 'ALL'>;
    upDown: UpDownRow[];
    range: RangeRow[];
  };

  const polyCommon: CommonGroup[] = polyGroups.map((g) => ({
    key: g.key,
    expiryMs: g.expiryMs,
    question: g.question,
    source: 'POLYMARKET',
    upDown: g.upDown,
    range: g.range,
  }));
  const kalshiCommon: CommonGroup[] = kalshiGroups.map((g) => ({
    key: g.key,
    expiryMs: g.expiryMs,
    question: g.question,
    source: 'KALSHI',
    upDown: g.upDown.map((r) => ({
      strikeUsd: r.strikeUsd,
      impliedProbUp: r.impliedProbUp,
      description: r.description,
      priceToBeatUsd: null,
    })),
    range: g.range,
  }));
  const dbCommon: CommonGroup[] = dbGroups.map((g) => ({
    key: `${g.oracleId}::${g.expiryMs}`,
    expiryMs: g.expiryMs,
    question: null,
    source: 'DEEPBOOK',
    upDown: g.upDown.map((r) => ({
      strikeUsd: r.strikeUsd,
      impliedProbUp: r.impliedProbUp,
      description: null,
      priceToBeatUsd: null,
    })),
    range: g.range.map((r) => ({
      floorStrikeUsd: r.floorStrikeUsd ?? 0,
      capStrikeUsd: r.capStrikeUsd ?? 0,
      rangeBandPct: r.rangeBandPct,
      impliedProbUp: r.impliedProbUp,
      description: null,
    })),
  }));

  let commonGroups: CommonGroup[];
  if (activeSource === 'POLYMARKET') {
    commonGroups = polyCommon;
  } else if (activeSource === 'KALSHI') {
    commonGroups = kalshiCommon;
  } else if (activeSource === 'DEEPBOOK') {
    commonGroups = dbCommon;
  } else {
    // ALL — combine from every source, interleaved by sort below.
    commonGroups = [...polyCommon, ...kalshiCommon, ...dbCommon];
  }

  // Flatten into a single list of entries, each carrying its source.
  const entries: Entry[] = [];
  for (const g of commonGroups) {
    if (g.upDown.length > 0) {
      entries.push({
        kind: 'upDown',
        key: `${g.key}::upDown`,
        expiryMs: g.expiryMs,
        question: g.question,
        rows: g.upDown,
        source: g.source,
      });
    }
    if (g.range.length > 0) {
      entries.push({
        kind: 'range',
        key: `${g.key}::range`,
        expiryMs: g.expiryMs,
        question: g.question,
        rows: g.range,
        source: g.source,
      });
    }
  }
  // Sort by expiry (soonest or latest, per sidebar). For the same
  // expiry, up/down renders before range so the two cards for that
  // expiry land adjacent.
  entries.sort((a, b) => {
    if (a.expiryMs !== b.expiryMs) {
      return sort === 'expiry_asc'
        ? a.expiryMs - b.expiryMs
        : b.expiryMs - a.expiryMs;
    }
    if (a.kind === b.kind) return 0;
    return a.kind === 'upDown' ? -1 : 1;
  });

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {firstLoad && loading && (
        <div className="text-sm text-gray-400">Loading latest markets…</div>
      )}

      {!firstLoad &&
        !loading &&
        activeSource === 'POLYMARKET' &&
        polyGroups.length === 0 &&
        !error && (
          <div className="text-sm text-gray-500 italic">
            No active markets. The Polymarket indexer may be empty right now.
          </div>
        )}

      {!firstLoad &&
        !loading &&
        activeSource === 'DEEPBOOK' &&
        dbGroups.length === 0 &&
        !error && (
          <div className="text-sm text-gray-500 italic">
            No active oracles. The DeepBook Predict testnet may be empty right now.
          </div>
        )}

      {!firstLoad &&
        !loading &&
        activeSource === 'KALSHI' &&
        kalshiGroups.length === 0 &&
        !error && (
          <div className="text-sm text-gray-500 italic">
            No active Kalshi markets right now.
          </div>
        )}

      {!firstLoad &&
        !loading &&
        activeSource === 'ALL' &&
        polyGroups.length === 0 &&
        dbGroups.length === 0 &&
        kalshiGroups.length === 0 &&
        !error && (
          <div className="text-sm text-gray-500 italic">
            No active markets across any source right now.
          </div>
        )}

      {renderEntries(entries)}
    </div>
  );
}
