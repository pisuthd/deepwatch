'use client';

/**
 * LocalSourceExplainerModal — must-dismiss explainer that surfaces the
 * first time the user toggles the InsightSourceSelector to `Local`.
 *
 * Three reasons this exists as a separate modal (rather than a toast or
 * inline banner):
 *   1. **Local is being deprecated.** Saying "Local is temporary and
 *      will be removed soon" is product-level news — the user should
 *      have to look at it once.
 *   2. **Walrus requires a stake.** Anyone reading the explainer needs
 *      to internalise that the durable path costs PLP — that's a
 *      decision, not a notification.
 *   3. **Local exists for evaluation.** Surfacing "use Local to try the
 *      platform with no barrier" makes the Local flow feel intentional
 *      rather than a degraded Walrus path.
 *
 * Dismissal: explicit button click only. Backdrop click and ESC are
 * intentionally NOT wired — this is a one-time-per-browser notice, not
 * a transient toast. After dismissal, a persistent localStorage flag
 * (`deepwatch:local-explainer-seen`) suppresses re-renders.
 */

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Database, Globe2, Sparkles, X } from 'lucide-react';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';
const green = '#00E68A';
const amber = '#FFA500';

interface LocalSourceExplainerModalProps {
  /** Parent-controlled open state. Set true the first time the user
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
                    style={{ color: amber }}
                  >
                    <AlertTriangle size={15} />
                    Local mode is temporary
                  </h2>
                  <div
                    className="text-[11px] mt-1 leading-relaxed"
                    style={{ color: textSecondary }}
                  >
                    A quick note before you use it.
                  </div>
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

              {/* Three explainer rows */}
              <div className="space-y-3">
                <Row
                  icon={<Database size={13} style={{ color: green }} />}
                  title="Local"
                  body={
                    <>
                      Stores AI insights <strong style={{ color: textPrimary }}>only in this browser</strong>.
                      Free and instant, but cleared if you wipe browser
                      data. <strong style={{ color: amber }}>Will be removed soon</strong> from
                      the platform.
                    </>
                  }
                />
                <Row
                  icon={<Globe2 size={13} style={{ color: green }} />}
                  title="Walrus"
                  body={
                    <>
                      Stores them <strong style={{ color: textPrimary }}>on-chain</strong> via the
                      Walrus storage layer. Durable and shareable, but
                      requires a PLP <strong style={{ color: textPrimary }}>subscription</strong> (stake).
                    </>
                  }
                />
                <Row
                  icon={<Sparkles size={13} style={{ color: green }} />}
                  title="Why use Local?"
                  body={
                    <>
                      Use Local to <strong style={{ color: textPrimary }}>evaluate the platform with no barrier</strong> — see
                      how the AI batches work, what the analyses look
                      like, how the cross-venue Compare table reads them.
                      When you&apos;re ready to keep results long-term,
                      stake PLP and switch to Walrus.
                    </>
                  }
                />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center px-3 py-2 rounded-md text-xs font-semibold transition-colors hover:bg-white/5"
                  style={{ color: textSecondary }}
                  title="Dismiss this notice"
                >
                  Got it
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-bold transition-opacity hover:opacity-90"
                  style={{
                    background: green,
                    color: '#000',
                  }}
                  title="Acknowledge — switch back to Walrus for durable storage later"
                >
                  Use Local for now
                </button>
              </div>

              {/* Subtle helper text — when localStorage wasn't available, this stays so
                  the user understands the dismissal persists in-memory only. */}
              <p
                className="text-[10px] leading-relaxed pt-1"
                style={{ color: textMuted }}
              >
                This notice will not appear again on this browser once
                dismissed.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Row({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg px-3 py-2.5"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="shrink-0 mt-0.5">{icon}</div>
      <div className="min-w-0 space-y-0.5">
        <div
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: green }}
        >
          {title}
        </div>
        <div
          className="text-[11px] leading-relaxed"
          style={{ color: textSecondary }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}
