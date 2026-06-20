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
 * Layout (v3 — Walrus-details design, mirrors
 * `pisuthd-deepwatch-a0ed929/app/components/pages/RecentInsightsPage.tsx`):
 *
 *   1. List of rows, one per CERTIFIED batch, sorted newest-first.
 *      Each row is a one-line summary: relative time, asset (when
 *      cached), status badge, filename, size, blob ID (truncated),
 *      and an "Open" link to the Walrus download URL.
 *   2. Click a row → expands inline. The expansion shows the public
 *      preview (HEAD_SIZE + MIDDLE_SIZE = 6 markets) + a Walrus
 *      details block: blob ID with copy, download URL with copy +
 *      open, SuiVision Walrus object link, and any error message
 *      from Tatum.
 *   3. Auto-refresh: every 30 s on idle, every 5 s while any row is
 *      PENDING / UPLOADING (so the badge flips to CERTIFIED without
 *      a manual refresh).
 *
 * Data flow:
 *   - On mount, `listWalrusUploads(TATUM_API_KEY, { limit: 50 })`.
 *   - Filter rows to `analysis-batch-<id>-<ts>.json` filenames.
 *   - On row click, lazy-fetch the blob body via
 *     `fetchInsightBlob(downloadUrlByQuiltId)`, validate, index in
 *     `batch-index-store`.
 *   - The cached body drives the per-row asset label, the
 *     `Preview · X UP · Y DOWN · Z NEUTRAL` summary, and the
 *     expanded market list.
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
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCcw,
} from 'lucide-react';
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
import { useNetwork } from '@/app/context/NetworkContext';

const TATUM_API_KEY =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TATUM_API_KEY) || '';

// Polling cadence: 30s on idle, 5s while any batch is still uploading.
const IDLE_POLL_MS = 30_000;
const ACTIVE_POLL_MS = 5_000;
const ASSET_ALL = 'ALL';
const ASSET_BTC = 'BTC';
const ASSET_SUI = 'SUI';
const ASSET_WAL = 'WAL';

// Free-slice cap. Mirrors `ai-batch-store.tsx`'s HEAD_SIZE + MIDDLE_SIZE
// (= 6) so the panel never claims "preview: 6 markets" but renders 3.
// Keep these in sync if the free-slice composition changes.
const FREE_SLICE_CAP = 6;

// SuiVision Walrus blob URL template. `{blobId}` and `{network}` are
// the only substitutions. Falls back to a Walrus scan URL when on a
// network SuiVision doesn't index.
function suivisionWalrusUrl(blobId: string, network: 'testnet' | 'mainnet'): string {
  return `https://${network}.suivision.xyz/walrus/${blobId}`;
}

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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
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

/**
 * Extract a best-guess asset label from a `BatchInsight` body. We
 * look at the first `MatchAnalysis.reasoning` text and search for any
 * of the known asset tickers. The matchKey is too opaque (hex
 * oracle IDs), so reasoning is the next-best source — most models
 * mention the ticker in the first sentence.
 *
 * Returns `null` when the body hasn't loaded yet, when reasoning is
 * empty, or when no known ticker is found. Caller renders "—".
 */
function inferAsset(insight: BatchInsight | null | undefined): string | null {
  if (!insight) return null;
  const KNOWN_ASSETS = ['BTC', 'ETH', 'SUI', 'WAL', 'SOL', 'DEEP', 'USDC'];
  for (const a of Object.values(insight.results)) {
    if (!a.reasoning) continue;
    const upper = a.reasoning.toUpperCase();
    for (const ticker of KNOWN_ASSETS) {
      // Word-boundary match — bare letter scan is too noisy (BTC
      // would match inside "ABTCXYZ").
      if (new RegExp(`\\b${ticker}\\b`).test(upper)) return ticker;
    }
  }
  return null;
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
  const { network } = useNetwork();
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
  //
  // v4+ uses a single blob per batch — the encrypted slice now lives
  // INLINE as base64 ciphertext + base64 wrapped-key on the same
  // blob's JSON, not as a separate Walrus file. There is therefore
  // no `-enc-` companion row to render. The `parsed.encrypted` check
  // below is defensive: any orphan `-enc-` rows left over from a v3
  // upload (two-blob shape) still get dropped, because their body is
  // opaque ciphertext that can't be parsed as `BatchInsight`.
  const visibleRows = useMemo<WalrusStorageJobStatusResponse[]>(() => {
    return rows
      .filter((r) => {
        const parsed = parseBatchFilename(r.filename);
        if (!parsed) return false;
        if (parsed.encrypted) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [rows]);

  const filteredRows = useMemo<WalrusStorageJobStatusResponse[]>(() => {
    if (filter === ASSET_ALL) return visibleRows;
    // Asset filter operates on the cached body. Rows we haven't
    // fetched yet are kept visible (so the user sees them in the
    // "ALL" view and gets an asset once they expand it).
    return visibleRows.filter((r) => {
      const parsed = parseBatchFilename(r.filename);
      if (!parsed) return false;
      const insight = batchIndex.getByBatchId(parsed.batchId);
      if (!insight) return true;
      return inferAsset(insight) === filter;
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
            network={network}
          />
        ))}
      </ul>
    </GlassCard>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PanelHeader({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <div className="space-y-1">
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
      <p
        className="text-[11px] leading-relaxed"
        style={{ color: textSecondary }}
        title={`Each batch uploads a single Walrus blob carrying a public plaintext preview (${FREE_SLICE_CAP} markets) + a Seal-encrypted slice with the full set. The encrypted slice is only readable by wallets with an active DeepWatch subscription.`}
      >
        Public preview per batch — first {FREE_SLICE_CAP} markets shown. The rest are
        Seal-encrypted and visible only to subscribers.{' '}
        <Link href="/app/stake" className="underline" style={{ color: green }}>
          Stake to unlock
        </Link>
      </p>
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
  network,
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
  network: 'testnet' | 'mainnet' | 'devnet' | 'localnet';
}) {
  const parsed = parseBatchFilename(row.filename);
  const isOpen =
    (expanded.kind === 'ready' || expanded.kind === 'loading' || expanded.kind === 'error') &&
    expanded.jobId === row.jobId;
  const cached = parsed ? getCachedInsight(parsed.batchId) : null;
  const asset = inferAsset(cached);
  const blobIdShort = row.blobId ? truncate(row.blobId, 14) : '—';

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 py-2 transition-colors hover:bg-white/[0.02]"
        disabled={row.status !== 'CERTIFIED' && !cached}
        title={row.status === 'CERTIFIED' || cached ? 'Toggle details' : 'Still uploading'}
      >
        {isOpen ? (
          <ChevronDown size={11} style={{ color: textSecondary }} />
        ) : (
          <ChevronRight size={11} style={{ color: textSecondary }} />
        )}
        {/* Date (relative) */}
        <span
          className="text-[10px] font-mono w-14 shrink-0"
          style={{ color: textSecondary }}
        >
          {fmtRelative(row.createdAt)}
        </span>
        {/* Asset */}
        <span
          className="text-[10px] font-mono w-12 shrink-0 px-1.5 py-0.5 rounded text-center"
          style={{
            background: asset ? 'rgba(255,255,255,0.06)' : 'transparent',
            color: asset ? textPrimary : textSecondary,
            opacity: asset ? 1 : 0.4,
          }}
        >
          {asset ?? '—'}
        </span>
        {/* Status badge */}
        <StatusBadge status={row.status} />
        {/* Filename */}
        <span
          className="font-mono text-[11px] truncate flex-1 min-w-0"
          style={{ color: textPrimary }}
          title={row.filename}
        >
          {row.filename}
        </span>
        {/* Blob ID (truncated) */}
        <span
          className="font-mono text-[10px] hidden lg:inline w-32 shrink-0 truncate"
          style={{ color: textSecondary }}
          title={row.blobId ?? ''}
        >
          {blobIdShort}
        </span>
        {/* Size */}
        <span
          className="text-[10px] font-mono w-14 text-right shrink-0 hidden md:inline"
          style={{ color: textSecondary }}
        >
          {fmtSize(row.sizeBytes)}
        </span>
        {/* Open link (download URL) */}
        <span className="w-6 shrink-0 inline-flex justify-end">
          {row.downloadUrlByQuiltId ? (
            <a
              href={row.downloadUrlByQuiltId}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-white/10"
              style={{ color: green }}
              title={row.downloadUrlByQuiltId}
            >
              <ExternalLink size={11} />
            </a>
          ) : (
            <span style={{ color: textSecondary, opacity: 0.3 }}>—</span>
          )}
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
            <ExpandedBody row={row} expanded={expanded} network={network} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ExpandedBody({
  row,
  expanded,
  network,
}: {
  row: WalrusStorageJobStatusResponse;
  expanded: ExpandedState;
  network: 'testnet' | 'mainnet' | 'devnet' | 'localnet';
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

  const [copied, setCopied] = useState<'blob' | 'url' | null>(null);

  const handleCopy = async (text: string, kind: 'blob' | 'url') => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Silent — clipboard blocked or non-HTTPS. The user can still
      // long-press the row to select & copy.
    }
  };

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
      <div className="py-3 pl-6 space-y-2">
        <div className="text-xs" style={{ color: red }}>
          {expanded.message}
        </div>
        {row.errorMessage && (
          <div
            className="rounded-md p-2 text-[10px]"
            style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
          >
            {row.errorMessage}
          </div>
        )}
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

  // Hard-cap the public preview to the free slice size. The free
  // slice is what the upload side writes onto the plaintext blob
  // (`HEAD_SIZE + MIDDLE_SIZE` markets); showing more than that
  // would defeat the gate. Belt-and-braces in case a future refactor
  // ever puts the FULL set on the plaintext blob.
  const entries = Object.values(insight.results).slice(0, FREE_SLICE_CAP);
  const encryptedCount = insight.encryptedMatchKeys?.length ?? 0;
  const hasEncryptedSlice = !!insight.encryptedPayload && !!insight.wrappedKey && !!insight.keyId;
  const signals = countSignals(insight);

  return (
    <div className="pl-6 pr-2 pb-3 space-y-3">
      {/* Markets (public preview) */}
      {entries.length > 0 ? (
        <ul className="space-y-1">
          {entries.map((a) => (
            <MarketLine key={a.matchKey} analysis={a} />
          ))}
        </ul>
      ) : (
        <div className="py-2 text-xs" style={{ color: textSecondary }}>
          No markets in this batch.
        </div>
      )}

      {/* Free-slice summary + Stake CTA */}
      <p
        className="text-[10px] pt-1 border-t border-white/5 leading-relaxed"
        style={{ color: textSecondary }}
        title={
          hasEncryptedSlice
            ? `Showing ${entries.length} markets from the public preview. The remaining ${encryptedCount} markets are Seal-encrypted and visible only to subscribers.`
            : 'Showing the public preview for this batch.'
        }
      >
        {hasEncryptedSlice ? (
          <>
            Public preview · {entries.length} of {encryptedCount + entries.length} markets ·
            {' '}{signals.up} UP · {signals.down} DOWN · {signals.neutral} NEUTRAL.{' '}
            The rest are Seal-encrypted.{' '}
            <Link href="/app/stake" className="underline" style={{ color: green }}>
              Stake to unlock
            </Link>
          </>
        ) : (
          <>
            {entries.length} market{entries.length === 1 ? '' : 's'} ·{' '}
            {signals.up} UP · {signals.down} DOWN · {signals.neutral} NEUTRAL.
          </>
        )}
      </p>

      {/* Walrus details block (blob ID + download URL + SuiVision) */}
      <div className="space-y-1.5 pt-1 border-t border-white/5">
        <div
          className="text-[10px] uppercase tracking-wide pt-1"
          style={{ color: textSecondary }}
        >
          Walrus details
        </div>

        {/* Blob ID */}
        <DetailRow
          label="Blob ID"
          value={row.blobId}
          displayValue={row.blobId ? truncate(row.blobId, 22) : '—'}
          onCopy={row.blobId ? () => handleCopy(row.blobId!, 'blob') : null}
          copied={copied === 'blob'}
        />

        {/* Sui object ID (Sui resource that certifies this blob) */}
        {row.suiObjectId && (
          <DetailRow
            label="Sui object"
            value={row.suiObjectId}
            displayValue={truncate(row.suiObjectId, 22)}
            href={`https://${network}.suivision.xyz/object/${row.suiObjectId}`}
          />
        )}

        {/* Download URL (with copy + open) */}
        <DownloadRow
          url={row.downloadUrlByQuiltId ?? row.downloadUrlByQuiltPatchId}
          copied={copied === 'url'}
          onCopy={() => {
            const u = row.downloadUrlByQuiltId ?? row.downloadUrlByQuiltPatchId;
            if (u) void handleCopy(u, 'url');
          }}
        />

        {/* SuiVision Walrus blob link (uses blobId) */}
        {row.blobId && (
          <DetailRow
            label="Walrus scan"
            value={suivisionWalrusUrl(row.blobId, network === 'mainnet' ? 'mainnet' : 'testnet')}
            displayValue="Open on SuiVision"
            href={suivisionWalrusUrl(row.blobId, network === 'mainnet' ? 'mainnet' : 'testnet')}
          />
        )}

        {/* Encrypted-slice metadata */}
        {hasEncryptedSlice && (
          <div
            className="rounded-md px-2.5 py-1.5 text-[10px] font-mono space-y-0.5"
            style={{ background: 'rgba(0, 230, 138, 0.05)' }}
          >
            <div className="flex items-center gap-1.5" style={{ color: green }}>
              <span className="font-semibold">Seal-encrypted slice</span>
              <span style={{ color: textSecondary }}>
                · {encryptedCount} market{encryptedCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="truncate" style={{ color: textSecondary }} title={insight.keyId ?? ''}>
              keyId: {insight.keyId ? truncate(insight.keyId, 22) : '—'}
            </div>
            <div className="truncate" style={{ color: textSecondary }} title={insight.poolObjectId ?? ''}>
              pool: {insight.poolObjectId ? truncate(insight.poolObjectId, 22) : '—'}
            </div>
          </div>
        )}

        {/* Error message (if any) */}
        {row.errorMessage && (
          <div
            className="rounded-md p-2 text-[10px]"
            style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
          >
            {row.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Detail row helpers ─────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  displayValue,
  href,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  displayValue?: string;
  href?: string;
  onCopy?: (() => void) | null;
  copied?: boolean;
}) {
  const display = displayValue ?? value;
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
          {label}
        </div>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-mono truncate inline-block max-w-full underline-offset-2 hover:underline"
            style={{ color: green }}
            title={value}
          >
            {display}
          </a>
        ) : (
          <div
            className="text-[11px] font-mono truncate"
            style={{ color: textPrimary }}
            title={value}
          >
            {display}
          </div>
        )}
      </div>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 p-1.5 rounded hover:bg-white/10"
          style={{ color: copied ? green : textSecondary }}
          title="Copy"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      )}
    </div>
  );
}

function DownloadRow({
  url,
  onCopy,
  copied,
}: {
  url: string | undefined;
  onCopy: () => void;
  copied: boolean;
}) {
  if (!url) {
    return (
      <DetailRow label="Download URL" value="" displayValue="—" />
    );
  }
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
          Download URL
        </div>
        <div
          className="text-[11px] font-mono truncate"
          style={{ color: textPrimary }}
          title={url}
        >
          {truncate(url, 60)}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onCopy}
          className="p-1.5 rounded hover:bg-white/10"
          style={{ color: copied ? green : textSecondary }}
          title="Copy URL"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="p-1.5 rounded hover:bg-white/10"
          style={{ color: green }}
          title="Open in new tab"
        >
          <ExternalLink size={11} />
        </a>
      </div>
    </div>
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
