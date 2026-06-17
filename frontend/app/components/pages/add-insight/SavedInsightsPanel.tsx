'use client';

/**
 * SavedInsightsPanel — collapsible list of every insight saved on this
 * device. Sits at the bottom of the Insights page (below the wizard)
 * so the create + browse flows share the same surface.
 *
 * Source of truth is `useInsights()` (localStorage-backed). Bodies
 * are stored inline next to each row, so opening any insight does not
 * require a network round-trip. Click a row's "View" to expand the
 * full `<InsightBodyView>` inline; click "Delete" to remove.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, Loader2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '../../common/GlassCard';
import InsightBodyView from '../insights/InsightBodyView';
import type { SavedInsight } from '../../../lib/insights';
import { useInsights } from '../../../stores/insights-store';
import { useToast } from '../../../context/ToastContext';

const green = '#00E68A';
const red = '#ef4444';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

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
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function SavedInsightsPanel() {
  const { insights, hydrated, remove, clear } = useInsights();
  const { notify } = useToast();
  const [open, setOpen] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const sorted = useMemo(
    () => [...insights].sort((a, b) => b.createdAt - a.createdAt),
    [insights],
  );

  function handleClear() {
    if (!confirmingClear) {
      setConfirmingClear(true);
      window.setTimeout(() => setConfirmingClear(false), 3000);
      return;
    }
    clear();
    setExpandedId(null);
    setConfirmingClear(false);
    notify('Cleared all saved insights.', { variant: 'success', title: 'Insights cleared' });
  }

  function handleDelete(id: string) {
    if (expandedId === id) setExpandedId(null);
    remove(id);
  }

  if (!hydrated) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 text-xs" style={{ color: textSecondary }}>
          <Loader2 size={12} className="animate-spin" />
          Loading saved insights…
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-base font-semibold" style={{ color: textPrimary }}>
            Saved insights
          </h2>
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.06)', color: textSecondary }}
          >
            {insights.length}
          </span>
          <span className="text-[11px] truncate" style={{ color: textSecondary }}>
            stored on this device
          </span>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {insights.length > 0 && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  handleClear();
                }
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
              style={{
                background: confirmingClear ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                border: confirmingClear ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                color: confirmingClear ? red : textSecondary,
              }}
              title={confirmingClear ? 'Click again to confirm' : 'Clear all insights'}
            >
              <Trash2 size={11} /> {confirmingClear ? 'Confirm clear' : 'Clear all'}
            </span>
          )}
          <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={16} style={{ color: textSecondary }} />
          </motion.div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              {sorted.length === 0 ? (
                <div className="py-6 text-center text-sm" style={{ color: textSecondary }}>
                  No insights saved yet. Generate one above and hit Save.
                </div>
              ) : (
                <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                  {sorted.map((row) => (
                    <SavedRow
                      key={row.id}
                      row={row}
                      isExpanded={expandedId === row.id}
                      onToggle={() =>
                        setExpandedId((cur) => (cur === row.id ? null : row.id))
                      }
                      onDelete={() => handleDelete(row.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

function SavedRow({
  row,
  isExpanded,
  onToggle,
  onDelete,
}: {
  row: SavedInsight;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <li>
      <div
        className="flex items-center gap-3 py-3 transition-colors"
        style={{
          background: isExpanded ? 'rgba(0,230,138,0.04)' : 'transparent',
        }}
      >
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 text-left flex items-center gap-3"
        >
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.06)', color: textPrimary }}
          >
            {row.body.asset}
          </span>
          <span
            className="text-sm font-medium truncate"
            style={{ color: textPrimary }}
            title={row.body.title}
          >
            {row.body.title}
          </span>
        </button>
        <span
          className="text-[11px] font-mono flex-shrink-0"
          style={{ color: textSecondary }}
        >
          {fmtSize(row.sourceBytes)}
        </span>
        <span
          className="text-[11px] font-mono flex-shrink-0 w-16 text-right"
          style={{ color: textSecondary }}
        >
          {fmtRelative(row.createdAt)}
        </span>
        <button
          onClick={onToggle}
          className="px-2.5 py-1 rounded text-[10px] font-semibold flex-shrink-0"
          style={{
            background: isExpanded ? 'rgba(0,230,138,0.10)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${isExpanded ? 'rgba(0,230,138,0.3)' : 'rgba(255,255,255,0.08)'}`,
            color: isExpanded ? green : textSecondary,
          }}
        >
          {isExpanded ? 'Hide' : 'View'}
        </button>
        <button
          onClick={onDelete}
          className="px-2 py-1 rounded text-[10px] font-semibold flex-shrink-0 inline-flex items-center gap-1"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            color: red,
          }}
          title="Delete"
        >
          <Trash2 size={11} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pb-4">
              <InsightBodyView body={row.body} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
