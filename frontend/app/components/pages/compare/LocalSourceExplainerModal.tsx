'use client';

/**
 * LocalSourceExplainerModal — short status notice shown whenever the
 * user flips the InsightSourceSelector to `Local`.
 *
 * Three things it has to communicate in a glance:
 *   1. **Why Local exists at all** — Shared insights on Walrus are
 *      stored on Mainnet via Tatum, which uses limited credits.
 *   2. **What Local is for** — generate insights locally to evaluate
 *      the platform with no barrier.
 *   3. **That it's going away** — Local mode will be removed in the
 *      next version.
 *
 * The "Shared insights on Walrus" line is the key context (it tells
 * the user *why* Local exists in the first place), so it's first.
 *
 * Dismissal: explicit button click only. Backdrop click and ESC are
 * intentionally NOT wired — this is a per-flip notice, not a transient
 * toast. The parent (`ComparePageClient`) re-opens the modal on every
 * Local flip, so dismissal only closes the current one.
 */

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Info, X } from 'lucide-react';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const green = '#00E68A';
const amber = '#FFA500';

interface LocalSourceExplainerModalProps {
  /** Parent-controlled open state. Set true every time the user
   *  flips the source selector to Local. */
  open: boolean;
  onClose: () => void;
}

export default function LocalSourceExplainerModal({
  open,
  onClose,
}: LocalSourceExplainerModalProps) {
  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="local-source-explainer"
          className="fixed inset-0 z-[60] flex items-center justify-center p-3 md:p-6"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="presentation"
        >
          <motion.div
            className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10"
            style={{
              background: 'rgba(26, 29, 46, 0.96)',
              backdropFilter: 'blur(20px)',
            }}
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="local-source-explainer-title"
          >
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

            <div className="relative z-10 p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2
                    id="local-source-explainer-title"
                    className="text-base font-bold flex items-center gap-2"
                    style={{ color: green }}
                  >
                    <Info size={15} />
                    You are using local mode
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors hover:bg-white/10"
                  style={{ color: textSecondary }}
                  aria-label="Close"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Three short lines — distilled from the previous
                  three-card layout. Kept tight so the modal doesn't
                  dominate the screen. */}
              <div
                className="space-y-2 text-xs leading-relaxed"
                style={{ color: textSecondary }}
              >
                <p>
                  Shared insights on Walrus run on Mainnet via Tatum
                  with limited credits.
                </p>
                <p>
                  Use Local to generate insights and evaluate the
                  platform right here in your browser.
                </p>
                <p>
                  <strong style={{ color: amber }}>Heads up:</strong>{' '}
                  Local mode will be removed in the next version.
                </p>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold transition-opacity hover:opacity-90"
                  style={{
                    background: green,
                    color: '#000',
                  }}
                  title="Dismiss this notice"
                >
                  Got it
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
