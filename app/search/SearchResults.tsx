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

/**
 * Renders a list of groups as two vertical sections — "Up / Down Markets"
 * and "Range Markets" — each sorted by expiry. The grouping library
 * (groupPolymarketMarkets / groupKalshiMarkets / groupDeepBookMarkets)
 * already sorts the groups, so this is just a render pass.
 *
 * The three source group types have different shapes (Polymarket/Kalshi
 * have `key`, `externalEventId`, `question`; DeepBook has `oracleId`,
 * `asset`, `spotUsd`, `forwardUsd`), so we normalize to a common shape
 * before passing to the cards.
 */
function renderSections(
  groups: Array<{
    key: string;
    expiryMs: number;
    upDown: UpDownRow[];
    range: RangeRow[];
  }>,
  cardPropsFor: (g: { expiryMs: number }) => CardProps,
) {
  const upDownGroups = groups.filter((g) => g.upDown.length > 0);
  const rangeGroups = groups.filter((g) => g.range.length > 0);
  if (upDownGroups.length === 0 && rangeGroups.length === 0) return null;
  return (
    <div className="space-y-6">
      {upDownGroups.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Up / Down Markets
          </h3>
          <div className="space-y-3">
            {upDownGroups.map((g) => (
              <UpDownCard
                key={g.key}
                {...cardPropsFor(g)}
                rows={g.upDown}
              />
            ))}
          </div>
        </section>
      )}
      {rangeGroups.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Range Markets
          </h3>
          <div className="space-y-3">
            {rangeGroups.map((g) => (
              <RangeCard
                key={g.key}
                {...cardPropsFor(g)}
                rows={g.range}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function SearchResults({ activeSource }: Props) {
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

  // Per-source loading flags (so we can show a small spinner on the
  // active source during interval refreshes after firstLoad flips to
  // false). Read from the same store.
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

  // Normalize each source's groups to the common shape that
  // renderSections expects, then call it.
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

  const cardPropsFor =
    activeSource === 'DEEPBOOK'
      ? (g: { expiryMs: number }): CardProps => {
          const db = dbGroups.find(
            (x) => x.expiryMs === g.expiryMs,
          );
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

      {renderSections(commonGroups, cardPropsFor)}
    </div>
  );
}
