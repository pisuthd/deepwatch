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

type UpDownRow = { strikeUsd: number; impliedProbUp: number };
type RangeRow = {
  floorStrikeUsd: number;
  capStrikeUsd: number;
  rangeBandPct: number;
  impliedProbUp: number;
};

interface CardProps {
  asset: string;
  spotUsd: number | null;
  forwardUsd: number | null;
  expiryMs: number;
  eyebrow: ReactNode;
}

type Entry =
  | { kind: 'upDown'; key: string; expiryMs: number; rows: UpDownRow[] }
  | { kind: 'range'; key: string; expiryMs: number; rows: RangeRow[] };

type SortOrder = 'expiry_asc' | 'expiry_desc';

/**
 * Renders the entries as a 2-column grid. Entries are paired into
 * rows of 2; each row (except the last) gets a full-width horizontal
 * divider that spans both columns. The cards themselves use the
 * original GlassCard variants.
 */
function renderEntries(
  entries: Entry[],
  cardPropsFor: (e: { expiryMs: number }) => CardProps,
) {
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
            {row.map((e) => (
              <div key={e.key}>
                {e.kind === 'upDown' ? (
                  <UpDownCard {...cardPropsFor(e)} rows={e.rows} />
                ) : (
                  <RangeCard {...cardPropsFor(e)} rows={e.rows} />
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function readSort(params: URLSearchParams): SortOrder {
  return params.get('sort') === 'expiry_desc' ? 'expiry_desc' : 'expiry_asc';
}

export default function SearchResults({ activeSource }: Props) {
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

  const eyebrow = PLATFORM_EYEBROW[activeSource];
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

  // Normalize each source's groups to a common shape.
  const commonGroups: Array<{
    key: string;
    expiryMs: number;
    upDown: UpDownRow[];
    range: RangeRow[];
  }> =
    activeSource === 'POLYMARKET'
      ? polyGroups.map((g) => ({
          key: g.key,
          expiryMs: g.expiryMs,
          upDown: g.upDown,
          range: g.range,
        }))
      : activeSource === 'KALSHI'
        ? kalshiGroups.map((g) => ({
            key: g.key,
            expiryMs: g.expiryMs,
            upDown: g.upDown,
            range: g.range,
          }))
        : dbGroups.map((g) => ({
            // DeepBook doesn't have a `key` field; synthesize one.
            key: `${g.oracleId}::${g.expiryMs}`,
            expiryMs: g.expiryMs,
            upDown: g.upDown.map((r) => ({
              strikeUsd: r.strikeUsd,
              impliedProbUp: r.impliedProbUp,
            })),
            range: g.range.map((r) => ({
              floorStrikeUsd: r.floorStrikeUsd ?? 0,
              capStrikeUsd: r.capStrikeUsd ?? 0,
              rangeBandPct: r.rangeBandPct,
              impliedProbUp: r.impliedProbUp,
            })),
          }));

  // Flatten into a single list of (kind, key, expiryMs, rows) entries.
  const entries: Entry[] = [];
  for (const g of commonGroups) {
    if (g.upDown.length > 0) {
      entries.push({
        kind: 'upDown',
        key: `${g.key}::upDown`,
        expiryMs: g.expiryMs,
        rows: g.upDown,
      });
    }
    if (g.range.length > 0) {
      entries.push({
        kind: 'range',
        key: `${g.key}::range`,
        expiryMs: g.expiryMs,
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

  const cardPropsFor =
    activeSource === 'DEEPBOOK'
      ? (g: { expiryMs: number }): CardProps => {
          const db = dbGroups.find((x) => x.expiryMs === g.expiryMs);
          return {
            asset: db?.asset ?? 'BTC',
            spotUsd: db?.spotUsd ?? null,
            forwardUsd: db?.forwardUsd ?? null,
            expiryMs: g.expiryMs,
            eyebrow,
          };
        }
      : (g: { expiryMs: number }): CardProps => ({
          asset: 'BTC',
          spotUsd: null,
          forwardUsd: null,
          expiryMs: g.expiryMs,
          eyebrow,
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

      {renderEntries(entries, cardPropsFor)}
    </div>
  );
}
