'use client';

/**
 * Insights — single-screen cross-venue comparison + saved insights.
 *
 * Layout (top to bottom):
 *
 *   1. Market picker (always visible) — 1d/3d/7d horizon chips over a
 *      compact list of DeepBook Predict oracles. Auto-selects the
 *      most-imminent market within the chosen horizon.
 *   2. Live compare panel — three side-by-side columns (DeepBook
 *      Predict / Polymarket / Kalshi) rendered with UpDownCard +
 *      RangeCard so the same strike ladder lines up across venues.
 *   3. AI summary card — collapsed by default (single Generate
 *      button). Click to stream the comparison; expand shows
 *      reasoning + analysis; Save button appears once the analysis
 *      has content; successful save swaps to a "Saved" chip.
 *   4. Saved insights panel — collapsible list of every insight
 *      stored on this device, with inline body view on click.
 *
 * No stepper, no step transitions, no auto-advance. The page reads
 * like a trading terminal, not a wizard.
 *
 * The page owns the streaming state (thinking + analysis buffers,
 * RAF flush loop, AbortController) and the localStorage save call
 * via `useInsights().add()`.
 */

import { useMemo, useRef, useState } from 'react';
import PageWrapper from '../common/PageWrapper';
import { useToast } from '../../context/ToastContext';
import {
  type InsightAsset,
  type InsightBody,
  type PredictSnapshot,
} from '../../lib/insights';
import { formatDetailedExpiry } from '@/lib/markets/format';
import { computeDeepBookLadder } from '@/lib/markets/deepbook';
import type { PolymarketGroup } from '@/lib/markets/polymarket';
import type { KalshiGroup } from '@/lib/markets/kalshi';
import { generateInsightStream } from '../../lib/minimax';
import { useInsights } from '../../stores/insights-store';
import type { Market as DbMarket } from '../../hooks/useMarkets';
import MarketPicker from './add-insight/MarketPicker';
import AISummaryCard from './add-insight/AISummaryCard';
import LiveComparePanel from './add-insight/LiveComparePanel';
import SavedInsightsPanel from './add-insight/SavedInsightsPanel';

interface PickedOracle {
  oracle: DbMarket;
  poly: PolymarketGroup | null;
  kalshi: KalshiGroup | null;
}

export default function AddInsightPage() {
  const { notify } = useToast();
  const insightsStore = useInsights();

  // Selection — driven by the MarketPicker, which auto-picks the
  // nearest market on mount and on horizon change.
  const [picked, setPicked] = useState<PickedOracle | null>(null);

  // We still need a PredictSnapshot for the body, but the wizard
  // derives everything from `picked.oracle`. Leave null for now and
  // hydrate from usePredict when the comparison page is wired.
  const [predict] = useState<PredictSnapshot | null>(null);

  // AI generation state
  const [analysis, setAnalysis] = useState('');
  const [thinking, setThinking] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingError, setGeneratingError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingAnalysisRef = useRef('');
  const pendingThinkingRef = useRef('');
  const rafRef = useRef<number | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedBytes, setSavedBytes] = useState<number | null>(null);

  // Auto-generated title from the selected oracle.
  const title = useMemo(() => {
    if (!picked) return '';
    return `${picked.oracle.asset} · ${formatDetailedExpiry(picked.oracle.expiryMs)}`;
  }, [picked]);

  const asset: InsightAsset = 'BTC';

  // Project the SVI surface onto the same 5-strike + 3-band ladder
  // the LiveComparePanel renders, so the AI sees the DeepBook side
  // of the 3-way comparison in the same shape as Polymarket/Kalshi.
  const dbComputed = useMemo(
    () => (picked ? computeDeepBookLadder(picked.oracle) : null),
    [picked],
  );

  const includes: InsightBody['includes'] = useMemo(() => {
    const out: InsightBody['includes'] = {};
    if (predict) out.predict = predict;
    if (picked) {
      out.live = {
        db: {
          oracleId: picked.oracle.oracle_id,
          expiryMs: picked.oracle.expiryMs,
          question: picked.oracle.name,
        },
        dbComputed: dbComputed
          ? {
              spotUsd: dbComputed.spotUsd,
              forwardUsd: dbComputed.forwardUsd,
              upDown: dbComputed.upDown,
              range: dbComputed.range,
            }
          : null,
        poly: picked.poly,
        kalshi: picked.kalshi,
      };
    }
    return out;
  }, [predict, picked, dbComputed]);

  const hasContext = !!picked;

  function handlePick(p: PickedOracle) {
    setPicked(p);
    // Reset downstream state on market change — old summary no
    // longer matches.
    setAnalysis('');
    setThinking('');
    setGeneratingError(null);
    setSavedId(null);
    setSavedBytes(null);
  }

  async function generate() {
    if (!hasContext) {
      setGeneratingError('Pick a DeepBook Predict market first.');
      return;
    }
    setGeneratingError(null);
    setAnalysis('');
    setThinking('');
    setSavedId(null);
    setSavedBytes(null);
    setGenerating(true);
    pendingAnalysisRef.current = '';
    pendingThinkingRef.current = '';

    // RAF flush loop. Drains BOTH buffers in the same frame so
    // reasoning and analysis re-render together. React 19
    // auto-batching combines the two setState calls into a single
    // render.
    const flush = () => {
      if (pendingThinkingRef.current) {
        const batch = pendingThinkingRef.current;
        pendingThinkingRef.current = '';
        setThinking((prev) => prev + batch);
      }
      if (pendingAnalysisRef.current) {
        const batch = pendingAnalysisRef.current;
        pendingAnalysisRef.current = '';
        setAnalysis((prev) => prev + batch);
      }
      rafRef.current = requestAnimationFrame(flush);
    };
    rafRef.current = requestAnimationFrame(flush);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const chunk of generateInsightStream(
        { title: title.trim(), asset, includes },
        controller.signal,
      )) {
        if (controller.signal.aborted) break;
        if (chunk.kind === 'thinking') {
          pendingThinkingRef.current += chunk.text;
        } else {
          pendingAnalysisRef.current += chunk.text;
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setGeneratingError(e instanceof Error ? e.message : 'Generation failed');
      }
    } finally {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (pendingThinkingRef.current) {
        setThinking((prev) => prev + pendingThinkingRef.current);
        pendingThinkingRef.current = '';
      }
      if (pendingAnalysisRef.current) {
        setAnalysis((prev) => prev + pendingAnalysisRef.current);
        pendingAnalysisRef.current = '';
      }
      setGenerating(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function save() {
    if (!analysis.trim() || saving || !picked) return;
    setSaving(true);
    try {
      const stored = insightsStore.add({
        title: title.trim(),
        asset,
        timestamp: Date.now(),
        analysis,
        includes,
      });
      if (stored) {
        setSavedId(stored.id);
        setSavedBytes(stored.sourceBytes);
        notify(
          `Saved — ${stored.sourceBytes} B.`,
          { variant: 'success', title: 'Insight saved' },
        );
      } else {
        notify(
          'Insight exceeds the 100 KB cap. Try a shorter summary.',
          { variant: 'error', title: 'Save failed' },
        );
      }
    } finally {
      setSaving(false);
    }
  }

  function generateAgain() {
    setAnalysis('');
    setThinking('');
    setGeneratingError(null);
    setSavedId(null);
    setSavedBytes(null);
  }

  return (
    <PageWrapper title="Insights">
      <div className="max-w-7xl mx-auto space-y-6">
        <MarketPicker
          selectedOracleId={picked?.oracle.oracle_id ?? null}
          onPick={handlePick}
        />
        <LiveComparePanel picked={picked} />
        <AISummaryCard
          title={title}
          asset={asset}
          hasContext={hasContext}
          analysis={analysis}
          thinking={thinking}
          generating={generating}
          generatingError={generatingError}
          saving={saving}
          savedId={savedId}
          savedBytes={savedBytes ?? undefined}
          onGenerate={generate}
          onCancel={cancel}
          onSave={save}
          onGenerateAgain={generateAgain}
        />
        <SavedInsightsPanel />
      </div>
    </PageWrapper>
  );
}
