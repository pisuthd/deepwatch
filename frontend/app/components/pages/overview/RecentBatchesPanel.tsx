'use client';

/**
 * RecentBatchesPanel — Overview-page panel that lists the most recent
 * AI batch uploads on Walrus (one row per `BatchInsight`).
 *
 * Replaces the old `/app/recent-insights` separate page. Per user
 * direction: "the old version we have separate page to show recent
 * insight but this new version we can have panel at the overview
 * page."
 *
 * Data flow:
 *   1. On mount, call `listWalrusUploads(TATUM_API_KEY, { limit: 50 })`.
 *   2. Filter rows to just `analysis-batch-<id>-<ts>.json` filenames
 *      (the rest are stray uploads under the same API key).
 *   3. Render one row per CERTIFIED batch (PENDING/UPLOADING/FAILED
 *      rows are also shown so the user can see upload progress).
 *   4. On row click, lazy-fetch the blob body via
 *      `fetchInsightBlob(downloadUrlByQuiltId)`, validate, index in
 *      `batch-index-store`, then expand the row to show one line per
 *      market.
 *   5. Auto-refresh: every 30 s on mount; every 5 s while any row is
 *      still PENDING or UPLOADING (so the user sees the badge flip
 *      to CERTIFIED without a manual refresh).
 *
 * Empty / error states:
 *   - No API key → "Tatum API key missing — add
 *     `NEXT_PUBLIC_TATUM_API_KEY` to your `.env` to list Walrus
 *     uploads."
 *   - API call fails → "Couldn't reach Tatum — Retry"
 *   - No batches yet → "No AI batches yet — run an analysis on the
 *     Compare page to populate this list."
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, ExternalLink, Loader2, RefreshCcw } from 'lucide-react';
import GlassCard from '../../common/GlassCard';
import {
  listWalrusUploads,
  fetchInsightBlob,
  parseBatchFilename,
  WALRUS_STATUS_COLORS,
  type WalrusStorageJobStatusResponse,
  type WalrusUploadStatus,
} from '@/app/lib/tatum';
import { useBatchIndex } from '@/app/stores/batch-index-store';
import {
  validateBatchInsight,
  type BatchInsight,
  type MatchAnalysis,
} from '@/app/lib/match-analyses';

const TATUM_API_KEY =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TATUM_API_KEY) || '';

// Polling cadence: 30s on idle, 5s while any batch is still uploading.
const IDLE_POLL_MS = 30_000;
const ACTIVE_POLL_MS = 5_000;
const ASSET_ALL = 'ALL';
const ASSET_BTC = 'BTC';
const ASSET_SUI = 'SUI';
const ASSET_WAL = 'WAL';

const green = '#00E68A';
const red = '#ef4444';
const cyan = '#3EC4C0';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

interface AssetFilterValue {
  value: string;
  label: string;
}

const ASSET_FILTERS: AssetFilterValue[] = [
  { value: ASSET_ALL, label: 'All assets' },
  { value: ASSET_BTC, label: 'BTC' },
  { value: ASSET_SUI, label: 'SUI' },
  { value: ASSET_WAL, label: 'WAL' },
];

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

type ExpandedState =
  | { kind: 'collapsed' }
  | { kind: 'loading'; jobId: string }
  | { kind: 'error'; jobId: string; message: string }
  | { kind: 'ready'; jobId: string; insight: BatchInsight };

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusColor(status: WalrusUploadStatus): { bg: string; text: string; label: string } {
  return WALRUS_STATUS_COLORS[status];
}

function countSignals(insight: BatchInsight | undefined): { up: number; down: number; neutral: number } {
  if (!insight) return { up: 0, down: 0, neutral: 0 };
  let up = 0, down = 0, neutral = 0;
  for (const k of Object.keys(insight.results)) {
    const a = insight.results[k];
    if (a.signal === 'UP') up++;
    else if (a.signal === 'DOWN') down++;
    else neutral++;
  }
  return { up, down, neutral };
}

function StatusBadge({ status }: { status: WalrusUploadStatus }) {
  const c = statusColor(status);
  return (
    <span
      className="font-mono font-semibold uppercase tracking-wider"
      style={{
        fontSize: 9,
        padding: '2px 6px',
        borderRadius: 4,
        background: c.bg,
        color: c.text,
        letterSpacing: '0.05em',
      }}
    >
      {c.label}
    </span>
  );
}

export default function RecentBatchesPanel() {
  const batchIndex = useBatchIndex();
  const [rows, setRows] = useState<WalrusStorageJobStatusResponse[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'idle' });
  const [filter, setFilter] = useState<string>(ASSET_ALL);
  const [expanded, setExpanded] = useState<ExpandedState>({ kind: 'collapsed' });
  // Track the last fetch timestamp to dedupe the auto-poll; prevents
  // two effects from racing when the component re-renders.
  const lastFetchRef = useRef<number>(0);
  // Sequence counter for `handleExpand` so a stale async response
  // (the user clicked a different row mid-fetch) doesn't overwrite a
  // newer expansion. Bumped on every click; the in-flight fetch
  // checks the seq before calling `setExpanded`.
  const expandSeqRef = useRef<number>(0);

  // ─── Fetching ────────────────────────────────────────────────────────────

  const refresh = useCallback(async (): Promise<void> => {
    if (!TATUM_API_KEY) {
      setLoadState({ kind: 'error', message: 'API key missing' });
      return;
    }
    try {
      const data = await listWalrusUploads(TATUM_API_KEY, { limit: 50 });
      lastFetchRef.current = Date.now();
      setRows(data);
      setLoadState({ kind: 'idle' });
    } catch (err) {
      setLoadState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Fetch failed',
      });
    }
  }, []);

  useEffect(() => {
    // Mark the initial loading state. The fetch itself runs from the
    // effect body to keep the data-fetch on the React commit path;
    // subsequent setStates inside `refresh` happen post-`await` so
    // they're outside the "sync in effect body" anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadState({ kind: 'loading' });
    void refresh();
  }, [refresh]);

  // Auto-poll. Use a shorter interval while any row is still uploading
  // so the badge flips to CERTIFIED in real time.
  useEffect(() => {
    if (loadState.kind === 'error') return;
    const hasActive = rows.some(
      (r) => r.status === 'PENDING' || r.status === 'UPLOADING',
    );
    const intervalMs = hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    const id = window.setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [loadState.kind, rows, refresh]);

  // ─── Derived view ───────────────────────────────────────────────────────

  // Filter to just `analysis-batch-...` rows (the rest are stray uploads
  // under the same API key). The asset filter is applied per row
  // metadata; the list itself doesn't carry the asset so the asset
  // filter operates on the cached `BatchInsight` body when expanded.
  // For collapsed rows we don't have the asset yet, so we don't filter
  // collapsed rows. (A v1.1 enhancement: extract asset from
  // `BatchInsight.cmcContext` or from a manifest blob.)
  const visibleRows = useMemo<WalrusStorageJobStatusResponse[]>(() => {
    return rows
      .filter((r) => parseBatchFilename(r.filename) != null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [rows]);

  const filteredRows = useMemo<WalrusStorageJobStatusResponse[]>(() => {
    if (filter === ASSET_ALL) return visibleRows;
    // Filter only when we have the body cached locally.
    return visibleRows.filter((r) => {
      const parsed = parseBatchFilename(r.filename);
      if (!parsed) return false;
      const insight = batchIndex.getByBatchId(parsed.batchId);
      if (!insight) return true; // don't drop rows whose body we haven't fetched
      // v1: we don't tag `BatchInsight` with an asset yet. The asset
      // filter is a UI affordance for the future; for now it filters
      // rows whose cached body is the requested asset. Until tagging
      // is added, this collapses to "show all" for non-ALL filters.
      return true;
    });
  }, [visibleRows, filter, batchIndex]);

  // ─── Row expansion ─────────────────────────────────────────────────────

  const handleExpand = useCallback(
    async (row: WalrusStorageJobStatusResponse) => {
      const parsed = parseBatchFilename(row.filename);
      if (!parsed) return;
      // Toggle off if already expanded for this row.
      if (expanded.kind === 'ready' && expanded.jobId === row.jobId) {
        setExpanded({ kind: 'collapsed' });
        return;
      }
      // Cache hit?
      const cached = batchIndex.getByBatchId(parsed.batchId);
      if (cached) {
        setExpanded({ kind: 'ready', jobId: row.jobId, insight: cached });
        return;
      }
      if (!row.downloadUrlByQuiltId) {
        setExpanded({
          kind: 'error',
          jobId: row.jobId,
          message: 'Walrus download URL not yet available',
        });
        return;
      }
      // Bump the seq so this in-flight fetch is identifiable. Stale
      // responses (user clicked a different row mid-fetch) check the
      // seq before writing `expanded`.
      const seq = ++expandSeqRef.current;
      setExpanded({ kind: 'loading', jobId: row.jobId });
      try {
        const raw = await fetchInsightBlob<unknown>(row.downloadUrlByQuiltId);
        if (seq !== expandSeqRef.current) return; // stale
        const insight = validateBatchInsight(raw);
        if (!insight) {
          setExpanded({
            kind: 'error',
            jobId: row.jobId,
            message: 'Invalid batch payload',
          });
          return;
        }
        batchIndex.set(insight);
        setExpanded({ kind: 'ready', jobId: row.jobId, insight });
      } catch (err) {
        if (seq !== expandSeqRef.current) return; // stale
        setExpanded({
          kind: 'error',
          jobId: row.jobId,
          message: err instanceof Error ? err.message : 'Fetch failed',
        });
      }
    },
    [expanded, batchIndex],
  );

  // ─── Render branches ───────────────────────────────────────────────────

  if (!TATUM_API_KEY) {
    return (
      <GlassCard>
        <PanelHeader />
        <EmptyMessage>
          Tatum API key missing — add <code>NEXT_PUBLIC_TATUM_API_KEY</code> to your
          {' '}<code>.env</code> to list Walrus uploads.
        </EmptyMessage>
      </GlassCard>
    );
  }

  if (loadState.kind === 'loading' && rows.length === 0) {
    return (
      <GlassCard>
        <PanelHeader />
        <div className="flex items-center gap-2 py-4 text-xs" style={{ color: textSecondary }}>
          <Loader2 size={14} className="animate-spin" />
          Loading recent batches…
        </div>
      </GlassCard>
    );
  }

  if (loadState.kind === 'error' && rows.length === 0) {
    return (
      <GlassCard>
        <PanelHeader onRefresh={refresh} />
        <EmptyMessage>
          {loadState.message}
          <button
            type="button"
            onClick={refresh}
            className="ml-2 inline-flex items-center gap-1 text-xs font-mono underline"
            style={{ color: cyan }}
          >
            <RefreshCcw size={11} /> Retry
          </button>
        </EmptyMessage>
      </GlassCard>
    );
  }

  if (visibleRows.length === 0) {
    return (
      <GlassCard>
        <PanelHeader onRefresh={refresh} />
        <EmptyMessage>
          No AI batches yet — run an analysis on the{' '}
          <Link href="/app/add-insight" className="underline" style={{ color: cyan }}>
            Compare
          </Link>{' '}
          page to populate this list.
        </EmptyMessage>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <PanelHeader onRefresh={refresh} />

      <div className="mt-3 mb-2 flex items-center gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-[11px] font-mono px-2 py-1 rounded border border-white/10 bg-black/20 outline-none"
          style={{ color: textPrimary }}
        >
          {ASSET_FILTERS.map((o) => (
            <option key={o.value} value={o.value} style={{ background: 'rgba(26,29,46,1)' }}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-[10px] font-mono" style={{ color: textSecondary }}>
          {filteredRows.length} {filteredRows.length === 1 ? 'batch' : 'batches'}
        </span>
      </div>

      <ul className="divide-y divide-white/5">
        {filteredRows.map((row) => (
          <BatchRow
            key={row.jobId}
            row={row}
            expanded={expanded}
            getCachedInsight={batchIndex.getByBatchId}
            onToggle={() => void handleExpand(row)}
          />
        ))}
      </ul>
    </GlassCard>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PanelHeader({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-lg font-bold" style={{ color: textPrimary }}>
        Recent AI batches
      </h3>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded transition-colors hover:bg-white/5"
          style={{ color: textSecondary }}
          title="Refresh from Tatum"
        >
          <RefreshCcw size={11} /> Refresh
        </button>
      )}
    </div>
  );
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="py-6 text-center text-xs"
      style={{ color: textSecondary }}
    >
      {children}
    </div>
  );
}

function BatchRow({
  row,
  expanded,
  getCachedInsight,
  onToggle,
}: {
  row: WalrusStorageJobStatusResponse;
  expanded: ExpandedState;
  /**
   * Synchronous lookup of the cached `BatchInsight` body for this row.
   * The parent passes `batchIndex.getByBatchId`, which reads from a
   * ref that's updated synchronously on `set` — so the row always sees
   * the freshest cached body on the same render the body is committed.
   */
  getCachedInsight: (id: string) => BatchInsight | null;
  onToggle: () => void;
}) {
  const parsed = parseBatchFilename(row.filename);
  const isOpen =
    (expanded.kind === 'ready' || expanded.kind === 'loading' || expanded.kind === 'error') &&
    expanded.jobId === row.jobId;
  const cached = parsed ? getCachedInsight(parsed.batchId) : null;
  const signals = countSignals(cached ?? undefined);
  const summary = cached
    ? `${signals.up} UP · ${signals.down} DOWN · ${signals.neutral} NEUTRAL`
    : row.status === 'CERTIFIED'
      ? '— open to load —'
      : '—';

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 py-2.5 transition-colors hover:bg-white/[0.02]"
        disabled={row.status !== 'CERTIFIED' && !cached}
        title={row.status === 'CERTIFIED' || cached ? 'Toggle details' : 'Still uploading'}
      >
        {isOpen ? (
          <ChevronDown size={12} style={{ color: textSecondary }} />
        ) : (
          <ChevronRight size={12} style={{ color: textSecondary }} />
        )}
        <span
          className="font-mono text-[11px] truncate flex-1 min-w-0"
          style={{ color: textPrimary }}
          title={row.filename}
        >
          {row.filename}
        </span>
        <StatusBadge status={row.status} />
        <span
          className="text-[10px] font-mono w-16 text-right"
          style={{ color: textSecondary }}
        >
          {fmtRelative(row.createdAt)}
        </span>
        <span
          className="text-[10px] font-mono w-44 text-right hidden sm:inline"
          style={{ color: textSecondary }}
        >
          {summary}
        </span>
        <span
          className="text-[10px] font-mono w-14 text-right hidden md:inline"
          style={{ color: textSecondary }}
        >
          {fmtSize(row.sizeBytes)}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <ExpandedBody
              row={row}
              expanded={expanded}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ExpandedBody({
  row,
  expanded,
}: {
  row: WalrusStorageJobStatusResponse;
  expanded: ExpandedState;
}) {
  // The cached insight is read from the parent's ref via the row's
  // `getCachedInsight` prop. We can't access it here directly, so
  // for the expanded view we trust the explicit `expanded.insight`
  // when it's `ready` for this row. The panel sets the cached body
  // before transitioning to `ready`, so the expanded body always has
  // the data.
  const insight =
    expanded.kind === 'ready' && expanded.jobId === row.jobId
      ? expanded.insight
      : null;

  if (expanded.kind === 'loading' && expanded.jobId === row.jobId) {
    return (
      <div className="flex items-center gap-2 py-3 pl-6 text-xs" style={{ color: textSecondary }}>
        <Loader2 size={12} className="animate-spin" />
        Fetching batch body…
      </div>
    );
  }
  if (expanded.kind === 'error' && expanded.jobId === row.jobId) {
    return (
      <div className="py-3 pl-6 text-xs" style={{ color: red }}>
        {expanded.message}
      </div>
    );
  }
  if (!insight) {
    return (
      <div className="py-3 pl-6 text-xs" style={{ color: textSecondary }}>
        Body unavailable. Try refresh.
      </div>
    );
  }
  const entries = Object.values(insight.results);
  if (entries.length === 0) {
    return (
      <div className="py-3 pl-6 text-xs" style={{ color: textSecondary }}>
        No markets in this batch.
      </div>
    );
  }
  return (
    <ul className="pl-6 pr-2 pb-2 space-y-1">
      {entries.map((a) => (
        <MarketLine key={a.matchKey} analysis={a} />
      ))}
    </ul>
  );
}

const SIGNAL_COLOR: Record<MatchAnalysis['signal'], string> = {
  UP: green,
  DOWN: red,
  NEUTRAL: cyan,
};
const SIGNAL_GLYPH: Record<MatchAnalysis['signal'], string> = {
  UP: '▲',
  DOWN: '▼',
  NEUTRAL: '▬',
};

function MarketLine({ analysis }: { analysis: MatchAnalysis }) {
  const color = SIGNAL_COLOR[analysis.signal];
  return (
    <li
      className="flex items-center gap-2 py-1.5 px-2 rounded"
      style={{ background: 'rgba(255,255,255,0.02)' }}
    >
      <span
        className="font-mono font-semibold uppercase tracking-wider shrink-0"
        style={{ color, fontSize: 10 }}
        title={`${analysis.signal} · ${Math.round(analysis.confidence * 100)}% confidence`}
      >
        {SIGNAL_GLYPH[analysis.signal]} {analysis.signal}
      </span>
      <span
        className="font-mono text-[10px] shrink-0"
        style={{ color: textSecondary }}
      >
        {Math.round(analysis.confidence * 100)}% · {Math.round(analysis.positionSizePct)}%
      </span>
      <span
        className="text-[10px] truncate flex-1 min-w-0"
        style={{ color: textPrimary }}
        title={analysis.reasoning}
      >
        {analysis.reasoning}
      </span>
      <span
        className="font-mono text-[10px] shrink-0 hidden sm:inline"
        style={{ color: textSecondary }}
        title={analysis.matchKey}
      >
        {analysis.matchKey.split('::').slice(-1)[0] ?? ''}
      </span>
      <a
        // The matchKey is the public matchKey — no URL is attached to
        // the analysis payload in v1 (we only capture it on the
        // Compare page). v1.1 will add per-row source-link chips.
        href="#"
        onClick={(e) => e.preventDefault()}
        className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-mono opacity-30"
        style={{ color: textSecondary }}
        title="Source links ship in v1.1"
      >
        <ExternalLink size={9} />
      </a>
    </li>
  );
}
