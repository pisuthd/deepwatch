'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import PageWrapper from '../common/PageWrapper';
import GlassCard from '../common/GlassCard';
import GlassDropdown from '../common/GlassDropdown';
import MarkdownRenderer from '../common/MarkdownRenderer';
import { useToast } from '../../context/ToastContext';
import {
  buildInsightPayload,
  insightFilename,
  INSIGHT_ASSETS,
  INSIGHT_MAX_BYTES,
  type InsightAsset,
} from '../../lib/insights';
import { pollWalrusStatus, uploadInsightToWalrus } from '../../lib/tatum';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const yellow = '#eab308';

const TATUM_API_KEY = process.env.NEXT_PUBLIC_TATUM_API_KEY ?? '';

const ASSET_OPTIONS = INSIGHT_ASSETS.map((a) => ({ value: a, label: a }));

/**
 * Add Insight — compose a markdown analysis for an asset, publish it to
 * Walrus via the Tatum Storage API. The on-chain blob is the durable record;
 * everything is uploaded as a single JSON file
 * (`insight-{ASSET}-{timestamp}.json`, ≤ 100 KB). The Recent Insights page
 * pulls the live list from Tatum, so this page is just an editor + submit.
 */
export default function AddInsightPage() {
  const { notify } = useToast();

  const [asset, setAsset] = useState<InsightAsset>('BTC');
  const [tag, setTag] = useState('');
  const [source, setSource] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [editorMode, setEditorMode] = useState<'write' | 'preview'>('write');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live size + cap check. The bytes the API will see are the JSON-serialized
  // payload, NOT the raw markdown — the asset/timestamp/tag/source wrappers
  // add a few dozen bytes on top.
  const { byteSize, overCap } = useMemo(() => {
    const payload = buildInsightPayload({
      asset,
      timestamp: Date.now(),
      markdown,
      tag: tag.trim() || undefined,
      source: source.trim() || undefined,
    });
    const serialized = JSON.stringify(payload);
    const size = new TextEncoder().encode(serialized).byteLength;
    return { byteSize: size, overCap: size > INSIGHT_MAX_BYTES };
  }, [asset, markdown, tag, source]);

  const missingKey = !TATUM_API_KEY;

  const canSubmit =
    !submitting &&
    !missingKey &&
    markdown.trim().length > 0 &&
    !overCap;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const timestamp = Date.now();
    const filename = insightFilename(asset, timestamp);
    const payload = buildInsightPayload({
      asset,
      timestamp,
      markdown: markdown.trim(),
      tag: tag.trim() || undefined,
      source: source.trim() || undefined,
    });

    const json = JSON.stringify(payload, null, 2);
    const bytes = new TextEncoder().encode(json).byteLength;
    if (bytes > INSIGHT_MAX_BYTES) {
      setError(`Insight exceeds 100 KB limit (${(bytes / 1024).toFixed(1)} KB).`);
      setSubmitting(false);
      return;
    }

    const file = new File([json], filename, { type: 'application/json' });

    try {
      const enqueued = await uploadInsightToWalrus(file, TATUM_API_KEY);
      notify(
        `Submitted as ${filename} — check Recent Insights once it certifies.`,
        { variant: 'info', title: 'Uploading' },
      );

      // Reset the editor but keep the asset so consecutive publishes are quick.
      setMarkdown('');
      setTag('');
      setSource('');
      setEditorMode('write');

      // Background poll — no local mirror, just to give the user a terminal
      // toast (success or failure). The Recent Insights page is the new
      // canonical view of the upload.
      void (async () => {
        try {
          const final = await pollWalrusStatus(enqueued.jobId, TATUM_API_KEY, {
            intervalMs: 2_000,
            maxAttempts: 20,
          });
          if (final.status === 'CERTIFIED') {
            notify(
              `Published (blob ${(final.blobId ?? '').slice(0, 10)}…)`,
              { variant: 'success', title: 'Insight certified' },
            );
          } else if (final.status === 'FAILED') {
            notify(
              final.errorMessage ?? 'Tatum rejected the upload.',
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
      setError(msg);
      notify(msg, { variant: 'error', title: 'Upload failed' });
    } finally {
      setSubmitting(false);
    }
  };

  // Clear the inline error as soon as the user starts fixing it.
  useEffect(() => {
    if (error) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, markdown, tag, source]);

  const sizeLabel = `${(byteSize / 1024).toFixed(2)} KB / ${INSIGHT_MAX_BYTES / 1024} KB`;

  return (
    <PageWrapper title="Add Insight">
      <div className="max-w-3xl space-y-4">
        {missingKey && (
          <div
            className="rounded-xl p-3 text-sm border"
            style={{
              background: 'rgba(234, 179, 8, 0.08)',
              borderColor: 'rgba(234, 179, 8, 0.3)',
              color: yellow,
            }}
          >
            Add <code className="font-mono">NEXT_PUBLIC_TATUM_API_KEY</code> to
            your <code className="font-mono">.env</code> to publish insights.
          </div>
        )}

        <GlassCard>
          <div className="space-y-4">
            {/* Asset */}
            <div>
              <label
                className="block text-[10px] uppercase tracking-wide mb-1.5"
                style={{ color: textSecondary }}
              >
                Asset
              </label>
              <GlassDropdown
                options={ASSET_OPTIONS}
                value={asset}
                onChange={(v) => setAsset(v as InsightAsset)}
              />
            </div>

            {/* Tag + Source row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  className="block text-[10px] uppercase tracking-wide mb-1.5"
                  style={{ color: textSecondary }}
                >
                  Tag <span style={{ color: textSecondary, opacity: 0.6 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="macro, onchain, ..."
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-mono text-white outline-none"
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                />
              </div>
              <div>
                <label
                  className="block text-[10px] uppercase tracking-wide mb-1.5"
                  style={{ color: textSecondary }}
                >
                  Source <span style={{ color: textSecondary, opacity: 0.6 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="web, svi-oracle, ..."
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-mono text-white outline-none"
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                />
              </div>
            </div>

            {/* Editor */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  className="block text-[10px] uppercase tracking-wide"
                  style={{ color: textSecondary }}
                >
                  Analysis
                </label>
                <div
                  className="flex items-center rounded-md overflow-hidden text-[10px] font-mono"
                  style={{ border: '1px solid rgba(255, 255, 255, 0.08)' }}
                >
                  <button
                    onClick={() => setEditorMode('write')}
                    className="px-2.5 py-1 transition-colors"
                    style={{
                      background:
                        editorMode === 'write'
                          ? 'rgba(0, 230, 138, 0.15)'
                          : 'rgba(255, 255, 255, 0.04)',
                      color: editorMode === 'write' ? green : textSecondary,
                    }}
                  >
                    Write
                  </button>
                  <button
                    onClick={() => setEditorMode('preview')}
                    className="px-2.5 py-1 transition-colors"
                    style={{
                      background:
                        editorMode === 'preview'
                          ? 'rgba(0, 230, 138, 0.15)'
                          : 'rgba(255, 255, 255, 0.04)',
                      color: editorMode === 'preview' ? green : textSecondary,
                    }}
                  >
                    Preview
                  </button>
                </div>
              </div>

              {editorMode === 'write' ? (
                <textarea
                  value={markdown}
                  onChange={(e) => setMarkdown(e.target.value)}
                  placeholder="# SUI analysis&#10;&#10;Markdown is supported — headings, lists, **bold**, *italics*, `code`, > quotes, | tables |, ~~strikethrough~~, [links](https://...)."
                  rows={14}
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-mono text-white outline-none resize-y"
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    minHeight: 280,
                  }}
                />
              ) : (
                <div
                  className="rounded-lg p-3 overflow-auto"
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    minHeight: 280,
                    maxHeight: 480,
                  }}
                >
                  {markdown.trim() ? (
                    <MarkdownRenderer content={markdown} />
                  ) : (
                    <p className="text-xs" style={{ color: textSecondary }}>
                      Nothing to preview yet.
                    </p>
                  )}
                </div>
              )}

              <div
                className="flex items-center justify-between mt-1.5 text-[10px] font-mono"
                style={{ color: overCap ? red : textSecondary }}
              >
                <span>
                  {byteSize.toLocaleString()} chars ·{' '}
                  <span style={{ color: overCap ? red : textSecondary }}>
                    {sizeLabel}
                  </span>
                </span>
                {overCap && (
                  <span style={{ color: red }}>Insight exceeds 100 KB limit</span>
                )}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                className="rounded-lg p-2.5 text-xs"
                style={{ background: 'rgba(239, 68, 68, 0.1)', color: red }}
              >
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full py-2.5 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              style={{
                background: canSubmit ? green : 'rgba(255, 255, 255, 0.08)',
                color: canSubmit ? '#000' : textSecondary,
                opacity: submitting ? 0.6 : 1,
              }}
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting
                ? 'Submitting…'
                : missingKey
                  ? 'API key not configured'
                  : markdown.trim().length === 0
                    ? 'Write some analysis first'
                    : overCap
                      ? 'Insight exceeds 100 KB'
                      : 'Publish to Walrus'}
            </button>
          </div>
        </GlassCard>

        <GlassCard>
          <p className="text-xs leading-relaxed" style={{ color: textSecondary }}>
            Insights are stored on <span style={{ color: textPrimary }}>Walrus</span> via{' '}
            <span style={{ color: textPrimary }}>Tatum</span>. The on-chain blob is publicly
            readable by anyone with the download URL. Each upload is a single JSON file capped at{' '}
            <span style={{ color: textPrimary }}>100 KB</span>. Do not include private keys, seed
            phrases, or anything else you don&apos;t want public.
          </p>
        </GlassCard>
      </div>
    </PageWrapper>
  );
}
