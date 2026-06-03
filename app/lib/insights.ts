/**
 * Insight metadata — the only client-side concerns are:
 *  - Which assets are valid (`INSIGHT_ASSETS`)
 *  - The 100 KB cap on the serialized JSON
 *  - A filename convention so Recent Insights can filter and label
 *    Walrus uploads by the list endpoint alone.
 *
 * The list of uploads is fetched live from Tatum on every mount — there is
 * no client-side mirror of the registry anymore. The asset lives in the
 * filename (`insight-{ASSET}-{timestamp}.json`) so the list endpoint is
 * enough to render the table; the full body (markdown, tag, source) is
 * lazily fetched via `fetchInsightBlob` only when a row is opened.
 */

export type InsightAsset = 'BTC' | 'SUI' | 'WAL';
export const INSIGHT_ASSETS: readonly InsightAsset[] = ['BTC', 'SUI', 'WAL'] as const;

export const INSIGHT_MAX_BYTES = 100 * 1024;
export const INSIGHT_FILENAME_PREFIX = 'insight-';

/**
 * The JSON body uploaded to Walrus. The asset is duplicated in the body
 * for self-containment — a reader who pulls the blob directly (no filename)
 * can still tell which asset it covers.
 */
export interface InsightBody {
  asset: InsightAsset;
  timestamp: number;
  markdown: string;
  tag?: string;
  source?: string;
}

/**
 * A row in the Recent Insights table. Combines the list endpoint's
 * `WalrusStorageJobStatusResponse` with the asset parsed out of the
 * filename. The body (`markdown`, `tag`, `source`) is NOT included —
 * fetching it is a separate request.
 */
export interface InsightRow {
  asset: InsightAsset;
  jobId: string;
  status: 'PENDING' | 'UPLOADING' | 'CERTIFIED' | 'FAILED';
  filename: string;
  sizeBytes: number;
  timestamp: number;
  errorMessage?: string;
  blobId?: string;
  suiObjectId?: string;
  downloadUrl?: string;
}

export function insightFilename(asset: InsightAsset, timestamp: number): string {
  return `${INSIGHT_FILENAME_PREFIX}${asset}-${timestamp}.json`;
}

/**
 * Parse `insight-{ASSET}-{timestamp}.json` back into its parts. Returns
 * `null` when the filename doesn't match the convention — callers use
 * that to filter the list endpoint's output down to "real" insights
 * and ignore any other uploads the API key has produced.
 */
export function parseInsightFilename(
  filename: string,
): { asset: InsightAsset; timestamp: number } | null {
  if (!filename.startsWith(INSIGHT_FILENAME_PREFIX)) return null;
  const stem = filename.slice(INSIGHT_FILENAME_PREFIX.length);
  if (!stem.endsWith('.json')) return null;
  const middle = stem.slice(0, -'.json'.length);
  const dash = middle.lastIndexOf('-');
  if (dash < 1) return null;
  const asset = middle.slice(0, dash) as InsightAsset;
  const ts = Number(middle.slice(dash + 1));
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (!(INSIGHT_ASSETS as readonly string[]).includes(asset)) return null;
  return { asset, timestamp: ts };
}

/**
 * Build the JSON payload that gets serialized and uploaded as a file.
 * Optional fields are omitted (not set to null) so the on-chain blob stays
 * minimal — every byte counts toward the 100 KB cap.
 */
export function buildInsightPayload(
  insight: Pick<InsightBody, 'asset' | 'timestamp' | 'markdown' | 'tag' | 'source'>,
): InsightBody {
  const payload: InsightBody = {
    asset: insight.asset,
    timestamp: insight.timestamp,
    markdown: insight.markdown,
  };
  if (insight.tag) payload.tag = insight.tag;
  if (insight.source) payload.source = insight.source;
  return payload;
}
