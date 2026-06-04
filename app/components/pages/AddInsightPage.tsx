'use client';

import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import PageWrapper from '../common/PageWrapper';
import Stepper from '../common/Stepper';
import { useToast } from '../../context/ToastContext';
import {
  buildInsightBody,
  insightFilename,
  INSIGHT_MAX_BYTES,
  type InsightAsset,
  type InsightBody,
  type PredictSnapshot,
  type PolymarketMarket,
} from '../../lib/insights';
import { generateInsightStream } from '../../lib/minimax';
import { pollWalrusStatus, uploadInsightToWalrus } from '../../lib/tatum';
import Step1Title, { defaultInsightTitle } from './add-insight/Step1Title';
import Step2Predict from './add-insight/Step2Predict';
import Step3Polymarket from './add-insight/Step3Polymarket';
import Step4Kalshi from './add-insight/Step4Kalshi';
import Step5Generate from './add-insight/Step5Generate';

const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

const TATUM_API_KEY = process.env.NEXT_PUBLIC_TATUM_API_KEY ?? '';

const STEPS = [
  { id: 1, label: 'Title' },
  { id: 2, label: 'Volatility' },
  { id: 3, label: 'Polymarket' },
  { id: 4, label: 'Kalshi' },
  { id: 5, label: 'Generate' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export default function AddInsightPage() {
  const { notify } = useToast();

  // ── Wizard navigation ────────────────────────────────────────────
  const [step, setStep] = useState<StepId>(1);
  const [furthestVisited, setFurthestVisited] = useState<StepId>(1);

  // ── Form state ───────────────────────────────────────────────────
  const [title, setTitle] = useState(() => defaultInsightTitle('BTC'));
  const [asset, setAsset] = useState<InsightAsset>('BTC');
  const [predict, setPredict] = useState<PredictSnapshot | null>(null);
  const [polymarket, setPolymarket] = useState<PolymarketMarket[]>([]);
  const [kalshi, setKalshi] = useState<string[]>([]);

  // ── AI generation state ──────────────────────────────────────────
  const [analysis, setAnalysis] = useState('');
  const [thinking, setThinking] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingError, setGeneratingError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Two separate buffers so reasoning and final prose can stream into
  // two independent React state slots. The RAF loop below drains both
  // in the same frame; React 19 auto-batches the two setState calls
  // into a single render.
  const pendingAnalysisRef = useRef('');
  const pendingThinkingRef = useRef('');
  const rafRef = useRef<number | null>(null);

  // ── Publish state ────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const includes: InsightBody['includes'] = useMemo(() => {
    const out: InsightBody['includes'] = {};
    if (predict) out.predict = predict;
    if (polymarket.length) out.polymarket = { markets: polymarket };
    if (kalshi.length) out.kalshi = { tickers: kalshi };
    return out;
  }, [predict, polymarket, kalshi]);

  const hasAnyCard = !!predict || polymarket.length > 0 || kalshi.length > 0;
  const titleOk = title.trim().length > 0;

  function goTo(id: StepId) {
    if (id > furthestVisited) return;
    setStep(id);
  }

  function goForward() {
    if (step >= 5) return;
    const next = (step + 1) as StepId;
    setStep(next);
    setFurthestVisited((f) => (next > f ? next : f));
  }

  function goBack() {
    if (step <= 1) return;
    setStep((step - 1) as StepId);
  }

  const canAdvance = step === 1 ? titleOk : step < 5;

  async function generate() {
    if (!hasAnyCard) {
      setGeneratingError('Add at least one data source on steps 2-4 first.');
      return;
    }
    setGeneratingError(null);
    setAnalysis('');
    setThinking('');
    setGenerating(true);
    pendingAnalysisRef.current = '';
    pendingThinkingRef.current = '';

    // RAF flush loop — batches chunk appends to once per frame.
    // Drains BOTH buffers in the same frame so reasoning and analysis
    // re-render together. React 19's auto-batching combines the two
    // setState calls into a single render.
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
      // Stop the flush loop
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      // Flush any remaining buffered text from either buffer
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

  async function publish() {
    if (!analysis.trim() || submitting) return;
    setSubmitting(true);
    setPublishError(null);
    try {
      const timestamp = Date.now();
      const body = buildInsightBody({
        title: title.trim(),
        asset,
        timestamp,
        analysis,
        includes,
      });
      const json = JSON.stringify(body, null, 2);
      const bytes = new TextEncoder().encode(json).byteLength;
      if (bytes > INSIGHT_MAX_BYTES) {
        setPublishError(`Insight exceeds 100 KB limit (${(bytes / 1024).toFixed(1)} KB).`);
        setSubmitting(false);
        return;
      }
      const file = new File(
        [json],
        insightFilename(asset, timestamp),
        { type: 'application/json' },
      );

      const enqueued = await uploadInsightToWalrus(file, TATUM_API_KEY);
      notify(
        'Submitted — open Recent Insights to see it once it finalises.',
        { variant: 'info', title: 'Uploading' },
      );

      setTitle(defaultInsightTitle(asset));
      setPredict(null);
      setPolymarket([]);
      setKalshi([]);
      setAnalysis('');
      setThinking('');
      setStep(1);
      setFurthestVisited(1);

      void (async () => {
        try {
          const final = await pollWalrusStatus(enqueued.jobId, TATUM_API_KEY, {
            intervalMs: 2_000,
            maxAttempts: 20,
          });
          if (final.status === 'CERTIFIED') {
            notify(
              'Published — your insight is live on-chain.',
              { variant: 'success', title: 'Insight certified' },
            );
          } else if (final.status === 'FAILED') {
            notify(
              final.errorMessage ?? 'Upload was rejected.',
              { variant: 'error', title: 'Upload failed' },
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Status polling failed';
          notify(msg, { variant: 'error', title: 'Status check failed' });
        }
      })();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setPublishError(msg);
      notify(msg, { variant: 'error', title: 'Upload failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageWrapper
      title="Add Insight"
      action={
        <Stepper
          steps={[...STEPS]}
          current={step}
          furthestVisited={furthestVisited}
          onSelect={(id) => goTo(id as StepId)}
        />
      }
    >
      <div className="max-w-3xl mx-auto space-y-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.18 }}
          >
            {step === 1 && (
              <Step1Title
                title={title} setTitle={setTitle}
                asset={asset} setAsset={setAsset}
              />
            )}
            {step === 2 && (
              <Step2Predict asset={asset} value={predict} onChange={setPredict} />
            )}
            {step === 3 && (
              <Step3Polymarket
                apiKey={TATUM_API_KEY}
                value={polymarket}
                onChange={setPolymarket}
              />
            )}
            {step === 4 && (
              <Step4Kalshi value={kalshi} onChange={setKalshi} />
            )}
            {step === 5 && (
              <Step5Generate
                title={title}
                asset={asset}
                includes={includes}
                hasAnyCard={hasAnyCard}
                analysis={analysis}
                thinking={thinking}
                generating={generating}
                generatingError={generatingError}
                onGenerate={generate}
                onCancel={cancel}
                onPublish={publish}
                submitting={submitting}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {publishError && (
          <div
            className="rounded-lg p-3 text-sm"
            style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
          >
            {publishError}
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={goBack}
            disabled={step === 1}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: 'rgba(255,255,255,0.04)',
              color: step === 1 ? 'rgba(156,163,175,0.4)' : textPrimary,
              border: '1px solid rgba(255,255,255,0.08)',
              cursor: step === 1 ? 'not-allowed' : 'pointer',
            }}
          >
            <ArrowLeft size={14} /> Back
          </button>
          {step < 5 && (
            <button
              onClick={goForward}
              disabled={!canAdvance}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: canAdvance ? green : 'rgba(255,255,255,0.08)',
                color: canAdvance ? '#000' : textSecondary,
                cursor: canAdvance ? 'pointer' : 'not-allowed',
              }}
            >
              Next <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}