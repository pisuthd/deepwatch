'use client';

/**
 * AiCell — the per-row AI column on the Compare table.
 *
 * Visibility is gated by `useStake`:
 *
 *   - **Non-staker** → locked by default
 *       A. Has an analysis (i.e. this match sits in the **free slice**
 *          of some batch — the first HEAD_SIZE + MIDDLE_SIZE entries
 *          are public, stored in `b.results[match.key]`) → show the
 *          analysis. Otherwise show "Analysing…" while a batch is
 *          in-flight on this row.
 *       B. Otherwise → "Stake to unlock" pill that links to
 *          `/app/stake`. Non-stakers can only see the public
 *          free-slice results; markets 4+ per batch are Seal-
 *          encrypted and require a valid Subscription NFT.
 *
 *   - **Staker** (`isStaker === true`)
 *       C. Analysis exists (free-slice or recently-batched, OR
 *          manually-decrypted from the encrypted slice) → same
 *          compact `<AnalysisView>` rendered for non-stakers.
 *       D. No analysis yet AND batch is in flight → "Analysing…"
 *       E. Otherwise → "Decrypt" pill. Click to Seal-decrypt the
 *          batch's encrypted slice on demand (the global bottom
 *          "Analyse X matches" button kicks the AI run; the
 *          per-cell "Decrypt" button recovers the encrypted-slice
 *          analyses for THIS market's batch using the wallet's
 *          Subscription NFT). On success the row flips to the
 *          analysis view (Branch C); on `SealAccessError` a toast
 *          surfaces the structured reason.
 *
 * The cell is read-only once populated (Branch C) — v1 doesn't
 * expose a re-analyse affordance. To force a refresh, clear
 * `localStorage` `deepwatch:match-analyses:v1` and click Analyse
 * again. The real fix (per-row refresh + staleness indicator) is a
 * v1.1 follow-up.
 *
 * Visual constants are shared with `MatchTable` so the cell reads
 * consistently against the rest of the row.
 */

import { useCallback, useMemo, useState } from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { useStake } from '@/app/hooks/useStake';
import { useSealDecrypt } from '@/app/hooks/useSealDecrypt';
import { useMatchAnalyses } from '@/app/stores/match-analyses-store';
import { useAiBatch } from '@/app/stores/ai-batch-store';
import { useBatchIndex } from '@/app/stores/batch-index-store';
import { useToast } from '@/app/context/ToastContext';
import { SealAccessError } from '@/app/lib/seal';
import type { DeepBookMatch } from '@/app/lib/match';
import type { MatchAnalysis } from '@/app/lib/match-analyses';

const green = '#00E68A';
const red = '#ef4444';
const neutral = '#cbd5e1';
const textSecondary = '#9ca3af';

interface AiCellProps {
  match: DeepBookMatch;
}

const SIGNAL_COLOR: Record<MatchAnalysis['signal'], string> = {
  UP: green,
  DOWN: red,
  NEUTRAL: neutral,
};

// Plain-language direction labels. The trade target is DeepBook Predict;
// Polymarket and Kalshi are reference data used to spot when DB's price
// disagrees with the rest of the market.
const DIRECTION_TEXT: Record<MatchAnalysis['signal'], string> = {
  UP: 'Bet UP',
  DOWN: 'Bet DOWN',
  NEUTRAL: 'No edge',
};
const DIRECTION_TOOLTIP: Record<MatchAnalysis['signal'], string> = {
  UP:
    'Bet the UP outcome on DeepBook Predict. You win if the price finishes above the strike at expiry. UP is recommended because DB\'s price is below the cross-venue consensus — DB looks "cheap" relative to Polymarket and Kalshi.',
  DOWN:
    'Bet the DOWN outcome on DeepBook Predict. You win if the price finishes below the strike at expiry. DOWN is recommended because DB\'s price is above the cross-venue consensus — DB looks "rich" relative to Polymarket and Kalshi.',
  NEUTRAL:
    'No meaningful edge — the cross-venue spread is too small to justify a trade. Stay flat on this market.',
};

function positionText(pct: number): string {
  if (pct < 0.5) return '0%';
  if (pct < 2) return `${Math.round(pct)}%`;
  if (pct < 5) return `${Math.round(pct)}%`;
  if (pct < 8) return `${Math.round(pct)}%`;
  return `${Math.round(pct)}%`;
}

function confidenceText(c: number): string {
  return `${Math.round(c * 100)}% sure`;
}

/**
 * Render the Branch C "analysis" view. Pure — given a MatchAnalysis
 * + the match's per-venue probs, returns JSX.
 *
 * Per user direction (Part 5): "we should show only nessary here and
 * move the rest to the modal." The cell shows only the trade call
 * (direction + size + confidence). Everything else — reasoning,
 * macro backdrop, price line, timestamp — lives in the hover
 * tooltip on the cell (and in the Predict page's MatchInsightPopover
 * for the long-form view).
 */
function AnalysisView({
  analysis,
  match,
}: {
  analysis: MatchAnalysis;
  match: DeepBookMatch;
}) {
  const color = SIGNAL_COLOR[analysis.signal];

  // Price line uses the same source-of-truth as the row itself, so
  // the per-venue numbers stay in sync with the rest of the table.
  const dbPrice = Math.round(match.dbProb * 100);
  const polyPrice =
    typeof match.polyProb === 'number'
      ? Math.round(match.polyProb * 100)
      : null;
  const kalshiPrice =
    typeof match.kalshiProb === 'number'
      ? Math.round(match.kalshiProb * 100)
      : null;

  // Cross-venue consensus = median of present venue probs. Computed
  // client-side so the tooltip can show the same number the AI used.
  const present = [match.dbProb, match.polyProb, match.kalshiProb].filter(
    (p): p is number => typeof p === 'number',
  );
  let consensusPct: number | null = null;
  if (present.length > 0) {
    const sorted = [...present].sort((a, b) => a - b);
    consensusPct = Math.round(sorted[Math.floor(sorted.length / 2)] * 100);
  }

  // Tooltip = full detail moved off the cell.
  const priceLineParts = [`DB ${dbPrice}¢`];
  if (polyPrice !== null) priceLineParts.push(`Poly ${polyPrice}¢`);
  if (kalshiPrice !== null) priceLineParts.push(`Kalshi ${kalshiPrice}¢`);
  if (consensusPct !== null) priceLineParts.push(`market avg ${consensusPct}¢`);

  const tooltipLines = [
    `${DIRECTION_TOOLTIP[analysis.signal]}`,
    '',
    `Cross-venue: ${priceLineParts.join(' · ')}`,
    '',
    `Why: ${analysis.reasoning}`,
    analysis.macroTake ? `Macro: ${analysis.macroTake}` : null,
    '',
    `Generated ${new Date(analysis.createdAt).toLocaleString()}`,
  ].filter((l): l is string => l !== null);

  return (
    <div
      className="flex flex-col items-end gap-0.5 max-w-[160px] cursor-help"
      title={tooltipLines.join('\n')}
    >
      <span
        className="font-bold"
        style={{ color, fontSize: 11 }}
      >
        {DIRECTION_TEXT[analysis.signal]}
      </span>
      <span
        className="font-mono"
        style={{ color: textSecondary, fontSize: 10 }}
      >
        {positionText(analysis.positionSizePct)} bankroll · {confidenceText(analysis.confidence)}
      </span>
    </div>
  );
}

export default function AiCell({ match }: AiCellProps) {
  const { isStaker } = useStake();
  const { getByMatchKey, hydrated, setMany: setManyAnalyses } = useMatchAnalyses();
  const { state } = useAiBatch();
  const batchIndex = useBatchIndex();
  const { decrypt: sealDecryptBatch, isSigning } = useSealDecrypt();
  const { notify } = useToast();
  // Per-cell decrypt-in-flight flag. Combined with `isSigning` (true
  // while the wallet is prompting for `signPersonalMessage`) so the
  // button reads "Decrypting…" from click through to either success
  // or toast — prevents double-clicks racing the key-server call.
  const [manualDecrypting, setManualDecrypting] = useState<boolean>(false);

  // "This row is part of the in-flight batch" = the provider is
  // currently analysing (or reviewing) AND this row is in the snapshot
  // of matches the batch was kicked with. Cells outside that snapshot
  // (e.g. a row that arrived via the 90 s poll mid-batch) do NOT get
  // the "Analysing…" label, because they weren't part of the request.
  const isAnalysing = useMemo<boolean>(() => {
    if (state.phase !== 'analysing' && state.phase !== 'reviewing') return false;
    return state.matches?.some((m) => m.key === match.key) ?? false;
  }, [state.phase, state.matches, match.key]);

  // While the store is hydrating from localStorage, `persisted` is
  // null — the cell stays locked / "Analyse" until the cache lands
  // (synchronously inside a useEffect). The in-flight result from the
  // provider's `latestResults` takes precedence over the persisted
  // cache so the cell updates in real-time as the SSE stream
  // produces results (no need to wait for `onBatchComplete` to flush).
  const persisted = useMemo<MatchAnalysis | null>(
    () => (hydrated ? getByMatchKey(match.key) : null),
    [hydrated, getByMatchKey, match.key],
  );
  const inFlight = useMemo<MatchAnalysis | null>(
    () => (state.phase === 'analysing' ? state.latestResults[match.key] ?? null : null),
    [state.phase, state.latestResults, match.key],
  );
  const analysis = inFlight ?? persisted;

  // Per-cell manual decrypt handler. MUST be declared above the
  // conditional returns below — calling a hook conditionally on
  // some renders (staker + no analysis + no in-flight) but not
  // others (staker + analysis present) breaks the Rules of Hooks.
  // Stakers without an analysis will render the Decrypt pill at the
  // bottom of this function; the handler runs `sealDecryptBatch`
  // against the batch gating this market's matchKey, caches the
  // decrypted slice, and pushes entries into the per-match store
  // so the row flips into the analysis branch on the next render.
  const handleManualDecrypt = useCallback(async (): Promise<void> => {
    if (manualDecrypting || isSigning) return;
    // Find the batch whose `encryptedMatchKeys` includes this market.
    // `batchIndex.all` is the in-memory list — Walrus hydration runs
    // on Compare-page mount, so by the time the user clicks this
    // button the index is already populated.
    const gated = batchIndex.all.find(
      (b) => b.encryptedMatchKeys?.includes(match.key) ?? false,
    );
    if (!gated) {
      notify(
        'No encrypted batch covers this market yet — run Analyse first.',
        { variant: 'warning', title: 'Nothing to decrypt' },
      );
      return;
    }
    if (!gated.wrappedKey || !gated.encryptedPayload || !gated.keyId) {
      // Old v3 blob without inline encryption metadata — fallback to
      // the Predict-page flow. Tell the user where to go.
      notify(
        'This batch was uploaded before the inline-encryption format. Open the market on Predict to read its analysis.',
        { variant: 'info', title: 'Legacy batch', duration: 6000 },
      );
      return;
    }
    setManualDecrypting(true);
    try {
      const decrypted = await sealDecryptBatch({
        wrappedKeyB64: gated.wrappedKey,
        encryptedPayloadB64: gated.encryptedPayload,
        keyIdHex: gated.keyId,
      });
      // Cache the decrypted slice on the batch (so other rows on
      // Compare / Predict don't re-pay the key-server roundtrip) and
      // push into the per-match store so the cell re-renders into
      // the analysis branch immediately.
      batchIndex.setEncryptedResults(gated.batchId, decrypted);
      const entries: Array<[string, MatchAnalysis]> = Object.entries(decrypted);
      setManyAnalyses(entries);
      if (decrypted[match.key]) {
        notify(
          `Decrypted ${entries.length} analyses from batch ${gated.batchId}.`,
          { variant: 'success', title: 'Decrypted', duration: 3000 },
        );
      } else {
        // Decrypt succeeded but THIS matchKey wasn't in the slice —
        // shouldn't happen if `encryptedMatchKeys.includes(match.key)`
        // was true, but guard anyway.
        notify(
          `Decrypted batch ${gated.batchId}, but this market wasn't in the slice.`,
          { variant: 'warning', title: 'Slice mismatch' },
        );
      }
    } catch (e: unknown) {
      if (e instanceof SealAccessError) {
        const title =
          e.reason === 'EXPIRED'
            ? 'Subscription expired'
            : e.reason === 'NAMESPACE_MISMATCH'
              ? 'Wrong pool'
              : 'Decrypt denied';
        notify(e.message ?? 'Seal denied the decrypt', {
          variant: 'error',
          title,
          duration: 8000,
        });
      } else {
        const msg = e instanceof Error ? e.message : 'Decrypt failed';
        notify(msg, { variant: 'error', title: 'Decrypt failed', duration: 8000 });
      }
    } finally {
      setManualDecrypting(false);
    }
  }, [
    batchIndex,
    isSigning,
    manualDecrypting,
    match.key,
    notify,
    sealDecryptBatch,
    setManyAnalyses,
  ]);

  const decrypting = manualDecrypting || isSigning;

  // --- Non-staker branches (locked-by-default) ---------------------
  // The 3 free-slice matches of each batch are public and land in the
  // local `match-analyses` cache (which is what `analysis` reads).
  // Anything that isn't in the cache defaults to locked, regardless of
  // whether the user is "currently looking at" an encrypted match —
  // we only render the analysis when the data is actually available,
  // so the free-slice carve-out falls out of the cache hit.
  if (!isStaker) {
    if (analysis) {
      return (
        <div className="flex justify-end">
          <AnalysisView analysis={analysis} match={match} />
        </div>
      );
    }
    if (isAnalysing) {
      return (
        <div className="flex justify-end">
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded uppercase font-semibold transition-opacity disabled:opacity-50"
            style={{
              background: 'rgba(0, 230, 138, 0.12)',
              border: '1px solid rgba(0, 230, 138, 0.3)',
              color: green,
              fontSize: 10,
              letterSpacing: '0.05em',
            }}
            title="AI analysis in progress…"
          >
            <Sparkles size={10} />
            Analysing…
          </button>
        </div>
      );
    }
    return (
      <div className="flex justify-end">
        <a
          href="/app/stake"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md uppercase font-bold transition-opacity hover:opacity-90"
          style={{
            background: green,
            color: '#000',
            fontSize: 10,
            letterSpacing: '0.05em',
          }}
          title="Stake PLP on the Stake page to unlock encrypted AI insights."
        >
          <Lock size={10} />
          Stake to unlock
        </a>
      </div>
    );
  }

  // --- Staker branches ----------------------------------------------
  if (analysis) {
    return (
      <div className="flex justify-end">
        <AnalysisView analysis={analysis} match={match} />
      </div>
    );
  }

  // Batch is in flight — show the same pill non-stakers see, so the
  // staker knows the bottom click was registered even though no
  // per-cell button exists anymore.
  if (isAnalysing) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded uppercase font-semibold transition-opacity disabled:opacity-50"
          style={{
            background: 'rgba(0, 230, 138, 0.12)',
            border: '1px solid rgba(0, 230, 138, 0.3)',
            color: green,
            fontSize: 10,
            letterSpacing: '0.05em',
          }}
          title="AI analysis in progress…"
        >
          <Sparkles size={10} />
          Analysing…
        </button>
      </div>
    );
  }

  // No analysis yet, no in-flight batch — for stakers, surface an
  // explicit "Decrypt" pill. `handleManualDecrypt` + `decrypting` are
  // declared above the early returns so the hook order stays stable
  // across renders (Rules of Hooks). The bottom global Analyse
  // button is for the AI run; this button is for the encrypted-slice
  // read on demand.
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void handleManualDecrypt();
        }}
        disabled={decrypting}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md uppercase font-bold transition-opacity disabled:opacity-50 hover:opacity-90"
        style={{
          background: green,
          color: '#000',
          fontSize: 10,
          letterSpacing: '0.05em',
        }}
        title="Decrypt this batch's encrypted slice using your Subscription NFT. First click will prompt a wallet signature."
      >
        <Lock size={10} />
        {decrypting ? 'Decrypting…' : 'Unlock'}
      </button>
    </div>
  );
}
