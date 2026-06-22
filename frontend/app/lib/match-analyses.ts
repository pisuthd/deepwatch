/**
 * Per-match AI analysis types + payload shape.
 *
 * The Compare page runs the AI in batch mode: one call to the
 * `record_market_signal` tool analyses every visible market, returning
 * one structured result per market. Each result is parsed into a
 * `MatchAnalysis` and persisted to `useMatchAnalyses()` (localStorage
 * key `deepwatch:match-analyses:v1`).
 *
 * Result fields map 1:1 to the tool input schema on the AI route:
 *   signal: UP / DOWN / NEUTRAL — directional read for the DB oracle
 *   confidence: 0.0–1.0 — how strong the read is
 *   positionSizePct: 0–100 — suggested bankroll allocation
 *   reasoning: one-sentence explanation (≤ 160 chars)
 *
 * The `cmcContext` field captures the macro snapshot at the moment of
 * analysis, so a "why was this signal generated?" re-render later
 * doesn't need to re-fetch CoinMarketCap.
 */

export type MatchSignal = 'UP' | 'DOWN' | 'NEUTRAL';

export interface MatchAnalysis {
  /** `${oracleId}::${expiryMs}` — matches `DeepBookMatch.key`. */
  matchKey: string;
  signal: MatchSignal;
  /** 0.0–1.0. How strong the read is. SVI-driven in the new framework. */
  confidence: number;
  /** 0–100. Suggested allocation of bankroll on this market. NEUTRAL = 0. */
  positionSizePct: number;
  /** One-sentence reasoning, ≤ 200 chars. The final action sentence. */
  reasoning: string;
  /**
   * One short line citing the SVI inputs and the direction they imply,
   * e.g. "SVI basis −0.6% + put_skew + SVI-vs-DB gap −7pp → DOWN".
   * ≤ 200 chars. Required for batches produced after the SVI-led
   * re-architecture; older batches won't have it.
   */
  sviTake?: string;
  /**
   * One short line describing what cross-venue (Polymarket / Kalshi)
   * said about this market, e.g. "Poly 28 / Kalshi 30 contradict SVI
   * by 4pp → downgraded". ≤ 200 chars. Required for batches produced
   * after the SVI-led re-architecture; older batches won't have it.
   */
  crossVenueTake?: string;
  /**
   * One short line citing the macro context that drove the call, e.g.
   * "Fear & Greed 22 (extreme fear) → leaning aggressive on UP". ≤ 120
   * chars. Optional — older batches (pre-macroTake) won't have it.
   */
  macroTake?: string;
  /** CoinMarketCap snapshot at analysis time (audit / re-render). */
  cmcContext: CmcContext | null;
  createdAt: number;
}

/**
 * Macro context snapshot at the moment an analysis was generated.
 *
 * The two sources the route hits are:
 *  - `/v3/fear-and-greed/latest` → primary sentiment signal
 *    (fear/greed is the most actionable number for a short-horizon
 *    binary-market read; BTC dominance itself is almost always
 *    in the 50–60% band and is not informative on its own)
 *  - `/v1/global-metrics/quotes/latest` → 24h sector trend signals
 *    (DeFi %, stablecoin %, derivatives %, BTC/ETH dominance trend)
 *    plus backdrop fields (total market cap, total 24h volume, active
 *    coins). Absolute dominance values are deliberately omitted — they
 *    don't move on a 24h horizon in any way the model can act on.
 */
export interface CmcContext {
  // Primary sentiment
  fearGreedValue: number | null;          // 0–100; e.g. 20
  fearGreedLabel: string | null;          // e.g. "Fear"
  fearGreedUpdatedAt: string | null;      // ISO timestamp from CMC
  // 24h sector trend (from /v1/global-metrics/quotes/latest)
  btcDominance24hChange: number | null;   // e.g. -0.18  (negative = altcoin gaining share)
  ethDominance24hChange: number | null;   // e.g. -0.04
  defi24hChange: number | null;           // e.g. -7.34  (DeFi sector 24h %)
  stablecoin24hChange: number | null;     // e.g. -5.50
  derivatives24hChange: number | null;    // e.g. -9.92
  // Backdrop
  totalMarketCapUsd: number | null;       // e.g. 2_168_647_624_127
  totalVolume24hUsd: number | null;       // e.g. 77_845_156_422
  activeCryptocurrencies: number | null;  // e.g. 8128
  fetchedAt: number;                      // when we made the request
}

/** Result frame emitted by the AI route's `record_market_signal` tool. */
export interface MatchAnalysisToolInput {
  matchKey: string;
  signal: MatchSignal;
  confidence: number;
  positionSizePct: number;
  reasoning: string;
  /** SVI-axis citation. ≤ 200 chars. Optional — the model is encouraged
   *  to include it but a missing value is accepted (older model
   *  checkpoints drop these and we don't want to lose an entire batch).
   *  The SVI inputs are already in the per-market prompt block, so the
   *  model's direction/confidence/size are still SVI-driven even if
   *  this field is absent. */
  sviTake?: string;
  /** Cross-venue citation. ≤ 200 chars. Optional — same rationale. */
  crossVenueTake?: string;
  /** Optional macro-context citation. ≤ 120 chars. */
  macroTake?: string;
}

/**
 * Validate a parsed tool input. Returns the normalised input on success,
 * or `null` if the shape is invalid (used by the SSE parser to drop
 * malformed frames silently).
 */
export function validateMatchAnalysisToolInput(
  raw: unknown,
): MatchAnalysisToolInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.matchKey !== 'string' || r.matchKey.length === 0) return null;
  if (r.signal !== 'UP' && r.signal !== 'DOWN' && r.signal !== 'NEUTRAL') return null;
  if (typeof r.confidence !== 'number' || !Number.isFinite(r.confidence)) return null;
  if (r.confidence < 0 || r.confidence > 1) return null;
  if (typeof r.positionSizePct !== 'number' || !Number.isFinite(r.positionSizePct)) return null;
  if (r.positionSizePct < 0 || r.positionSizePct > 100) return null;
  if (typeof r.reasoning !== 'string') return null;
  const sviTake =
    typeof r.sviTake === 'string' && r.sviTake.length > 0
      ? r.sviTake.slice(0, 200)
      : undefined;
  const crossVenueTake =
    typeof r.crossVenueTake === 'string' && r.crossVenueTake.length > 0
      ? r.crossVenueTake.slice(0, 200)
      : undefined;
  const macroTake =
    typeof r.macroTake === 'string' && r.macroTake.length > 0
      ? r.macroTake.slice(0, 120)
      : undefined;
  return {
    matchKey: r.matchKey,
    signal: r.signal,
    confidence: r.confidence,
    positionSizePct: r.positionSizePct,
    reasoning: r.reasoning.slice(0, 200),
    ...(sviTake ? { sviTake } : {}),
    ...(crossVenueTake ? { crossVenueTake } : {}),
    ...(macroTake ? { macroTake } : {}),
  };
}

// ─── Batch (Walrus) shape ──────────────────────────────────────────────────

/**
 * One full AI batch — what gets serialised and uploaded to Walrus as a
 * single blob, and what gets returned from `fetchInsightBlob<BatchInsight>`.
 *
 * Per user direction (Part 3): one blob per batch, not one per match.
 * The blob body is small (≈ 12 KB for 12 markets) and contains every
 * `MatchAnalysis` produced in the batch. The Predict page's
 * `useMatchInsight` hook indexes this map by `matchKey` to look up a
 * single market.
 *
 * # v2 (hybrid Seal + AES encryption)
 *
 * Per user direction (hackathon v2): the *first 3 markets per batch*
 * live in `results` (plaintext, anyone can read). The *full set*
 * is AES-256-GCM-encrypted; the AES key is itself Seal-encrypted
 * (the "hybrid" pattern). Only wallets holding a valid
 * `deepwatch::subscription::Subscription` NFT can recover the AES
 * key via Seal and therefore decrypt the full set.
 *
 * The hybrid cuts Walrus cost in half vs the prior "two blobs per
 * batch" approach (plaintext blob + separate Seal blob), because
 * the encrypted slice now lives inline in the same JSON — base64
 * ciphertext and base64 wrapped-key, sitting next to the plaintext
 * `results` and the `encryptedMatchKeys` list.
 *
 * `encryptedMatchKeys` is a deliberately-unencrypted list of the
 * matchKeys behind the gate. This is metadata, not analysis
 * content — exposing the key list doesn't leak the analysis. The
 * `useMatchInsight` hook uses it to know when to attempt a decrypt.
 *
 * Filename convention: `analysis-batch-<batchId>-<timestampMs>.json`
 * (see `parseBatchFilename` / `batchFilename` in `app/lib/tatum.ts`).
 */
export interface BatchInsight {
  /** Random 8-char hex ID, generated when the batch was kicked. */
  batchId: string;
  /** Unix ms — the moment the batch was kicked. Encoded in the filename. */
  createdAt: number;
  /** Macro context captured at the start of the batch (audit / re-render). */
  cmcContext: CmcContext | null;
  /**
   * Per-match results for the **free slice** (first 3 markets by
   * insertion order). Keyed by `matchKey` (= `DeepBookMatch.key`).
   * The full set lives behind `encryptedPayload` (AES-encrypted).
   */
  results: Record<string, MatchAnalysis>;
  /**
   * `matchKey`s behind the Seal gate. Unencrypted metadata so the
   * Predict page's `useMatchInsight` can know to attempt a decrypt
   * without first fetching the ciphertext.
   */
  encryptedMatchKeys?: string[];
  /**
   * Base64-encoded AES-256-GCM ciphertext of the full-set JSON
   * (the `{ batchId, createdAt, cmcContext, results: allEntries }`
   * blob). Format: `[12-byte IV][ciphertext][16-byte GCM tag]`. See
   * `lib/aes.ts` for the wire layout. `undefined` for batches that
   * had ≤ 3 markets (no encryption needed).
   */
  encryptedPayload?: string;
  /**
   * Base64-encoded Seal ciphertext wrapping the AES key (32 raw bytes).
   * Decrypt path: `Seal-decrypt(wrappedKey) → AES key → AES-decrypt(encryptedPayload)`.
   */
  wrappedKey?: string;
  /**
   * Seal key-id in hex. Format: `[poolObjectIdBytes ++ 5-byte-nonce]`.
   * The first N bytes must match `poolObjectId`; the last 5 are
   * random per blob (set at encrypt time, stored here so the
   * read-side can rebuild the same `seal_approve` PTB).
   */
  keyId?: string;
  /**
   * Hex of the shared `Pool` object ID that owns the namespace. Used
   * by `sealDecrypt` to derive the `seal_approve` move-call target.
   */
  poolObjectId?: string;
  /**
   * Cached decrypted entries — populated by `useMatchInsight` /
   * `ComparePageClient` the first time a wallet successfully
   * decrypts the encrypted slice. Subsequent reads skip the
   * decrypt roundtrip. `undefined` until the first decrypt succeeds
   * (or forever, for non-stakers).
   */
  encryptedResults?: Record<string, MatchAnalysis>;
  /**
   * Filename of the batch's single Walrus blob. Stored so
   * `listWalrusUploads` matches can find the right body via the
   * filename-based `parseBatchFilename` filter.
   */
  plaintextFilename?: string;
}

/**
 * Validate a parsed batch blob. Returns the validated batch on success,
 * or `null` if the shape is invalid (used by the Recent Batches panel to
 * drop corrupt blobs).
 */
export function validateBatchInsight(raw: unknown): BatchInsight | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.batchId !== 'string' || r.batchId.length === 0) return null;
  if (typeof r.createdAt !== 'number' || !Number.isFinite(r.createdAt)) return null;
  if (!r.results || typeof r.results !== 'object' || Array.isArray(r.results)) return null;

  const out: Record<string, MatchAnalysis> = {};
  for (const [k, v] of Object.entries(r.results as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Partial<MatchAnalysis>;
    if (
      typeof e.matchKey !== 'string' ||
      typeof e.signal !== 'string' ||
      (e.signal !== 'UP' && e.signal !== 'DOWN' && e.signal !== 'NEUTRAL') ||
      typeof e.confidence !== 'number' ||
      typeof e.positionSizePct !== 'number' ||
      typeof e.reasoning !== 'string' ||
      typeof e.createdAt !== 'number'
    ) {
      continue;
    }
    // `sviTake` / `crossVenueTake` / `macroTake` are all optional
    // (older batches won't have them) — keep each only if it's a
    // non-empty string.
    const sviTake =
      typeof e.sviTake === 'string' && e.sviTake.length > 0
        ? e.sviTake.slice(0, 200)
        : undefined;
    const crossVenueTake =
      typeof e.crossVenueTake === 'string' && e.crossVenueTake.length > 0
        ? e.crossVenueTake.slice(0, 200)
        : undefined;
    const macroTake =
      typeof e.macroTake === 'string' && e.macroTake.length > 0
        ? e.macroTake.slice(0, 120)
        : undefined;
    out[k] = {
      matchKey: e.matchKey,
      signal: e.signal,
      confidence: e.confidence,
      positionSizePct: e.positionSizePct,
      reasoning: e.reasoning,
      cmcContext: (e.cmcContext as CmcContext | null | undefined) ?? null,
      createdAt: e.createdAt,
      ...(sviTake ? { sviTake } : {}),
      ...(crossVenueTake ? { crossVenueTake } : {}),
      ...(macroTake ? { macroTake } : {}),
    };
  }

  return {
    batchId: r.batchId,
    createdAt: r.createdAt,
    cmcContext: (r.cmcContext as CmcContext | null) ?? null,
    results: out,
    // Optional v2 fields — pass through when present, validated loosely
    // (they're either base64 ciphertext, hex strings we wrote
    // ourselves, or filenames).
    ...(Array.isArray(r.encryptedMatchKeys)
      ? {
          encryptedMatchKeys: (r.encryptedMatchKeys as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          ),
        }
      : {}),
    ...(typeof r.encryptedPayload === 'string' && r.encryptedPayload.length > 0
      ? { encryptedPayload: r.encryptedPayload }
      : {}),
    ...(typeof r.wrappedKey === 'string' && r.wrappedKey.length > 0
      ? { wrappedKey: r.wrappedKey }
      : {}),
    ...(typeof r.keyId === 'string' ? { keyId: r.keyId } : {}),
    ...(typeof r.poolObjectId === 'string' ? { poolObjectId: r.poolObjectId } : {}),
    ...(typeof r.plaintextFilename === 'string' ? { plaintextFilename: r.plaintextFilename } : {}),
    // `encryptedResults` is intentionally NOT read from disk — it's a
    // per-session in-memory cache populated by `useMatchInsight` after
    // a successful Seal-decrypt. We never persist it to the plaintext
    // blob (would defeat the gate) and we never re-validate it from
    // Walrus (it's reconstructed on read).
  };
}
