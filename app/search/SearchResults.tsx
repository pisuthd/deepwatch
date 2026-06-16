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

type Platform = 'DEEPBOOK' | 'POLYMARKET' | 'KALSHI';

interface Props {
  activeSource: Platform;
}

// Eyebrow node per platform — passed into both card types so the card
// title reflects the source of the data, not a hardcoded label.
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
  | { kind: 'upDown'; key: string; expiryMs: number; question: string | null; rows: UpDownRow[] }
  | { kind: 'range'; key: string; expiryMs: number; question: string | null; rows: RangeRow[] };

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
              // Card props common to all sources.
              const cardProps: CardProps = {
                asset: 'BTC',
                spotUsd: null,
                forwardUsd: null,
                expiryMs: e.expiryMs,
                question: e.question,
                eyebrow: PLATFORM_EYEBROW[activeSourceForEntry(e)],
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

// The eyebrow needs to reflect the source of the entry. Since we only
// render entries from the active source in the loop above, we use the
// module-level activeSource passed in via closure (defined below).
let activeSourceForEntry = (_e: Entry): Platform => 'POLYMARKET';

function readSort(params: URLSearchParams): SortOrder {
  return params.get('sort') === 'expiry_desc' ? 'expiry_desc' : 'expiry_asc';
}

export default function SearchResults({ activeSource }: Props) {
  // Update the closure variable so renderEntries picks up the current
  // active source for the eyebrow.
  activeSourceForEntry = () => activeSource;

  const params = useSearchParams();
  const sort = readSort(new URLSearchParams(params.toString()));

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

  // Grouping lives in the lib; SearchResults is a pure view layer.
  const polyGroups = useMemo<PolymarketGroup[]>(
    () => (polyRows ? groupPolymarketMarkets(polyRows) : []),
    [polyRows],
  );
  const dbGroups = useMemo<DeepBookGroup[]>(
    () => (dbRows ? (groupDeepBookMarkets(dbRows) as DeepBookGroup[]) : []),
    [dbRows],
  );
  const kalshiGroups = useMemo<KalshiGroup[]>(
    () => (kalshiRows ? groupKalshiMarkets(kalshiRows) : []),
    [kalshiRows],
  );

  const loading =
    activeSource === 'POLYMARKET'
      ? polyLoading
      : activeSource === 'KALSHI'
        ? kalshiLoading
        : dbLoading;
  const error =
    activeSource === 'POLYMARKET'
      ? polyError
      : activeSource === 'KALSHI'
        ? kalshiError
        : dbError;

  // Normalize each source's groups to a common shape, carrying both
  // the per-group question (Polymarket/Kalshi) and per-row description
  // (Polymarket/Kalshi) from the API. DeepBook groups carry null
  // question + null description — its cards fall back to the generated
  // text.
  type CommonGroup = {
    key: string;
    expiryMs: number;
    question: string | null;
    upDown: UpDownRow[];
    range: RangeRow[];
  };

  let commonGroups: CommonGroup[];

  if (activeSource === 'POLYMARKET') {
    commonGroups = polyGroups.map((g) => ({
      key: g.key,
      expiryMs: g.expiryMs,
      question: g.question,
      upDown: g.upDown,
      range: g.range,
    }));
  } else if (activeSource === 'KALSHI') {
    commonGroups = kalshiGroups.map((g) => ({
      key: g.key,
      expiryMs: g.expiryMs,
      question: g.question,
      upDown: g.upDown,
      range: g.range,
    }));
  } else {
    // DEEPBOOK — synthesize a key and use generated question/description.
    commonGroups = dbGroups.map((g) => ({
      key: `${g.oracleId}::${g.expiryMs}`,
      expiryMs: g.expiryMs,
      question: null,
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
  }

  // Flatten into a single list of (kind, key, expiryMs, question, rows) entries.
  const entries: Entry[] = [];
  for (const g of commonGroups) {
    if (g.upDown.length > 0) {
      entries.push({
        kind: 'upDown',
        key: `${g.key}::upDown`,
        expiryMs: g.expiryMs,
        question: g.question,
        rows: g.upDown,
      });
    }
    if (g.range.length > 0) {
      entries.push({
        kind: 'range',
        key: `${g.key}::range`,
        expiryMs: g.expiryMs,
        question: g.question,
        rows: g.range,
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

      {renderEntries(entries)}
    </div>
  );
}
