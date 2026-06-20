'use client';

/**
 * LpProvisionModal — modal wrapper around `LpProvisionFormBody`.
 *
 * Opened from the Stake page's Pools tab when the user clicks the
 * "Deposit DUSDC → PLP" CTA on the DUSDC Liquidity card. Renders the
 * same form body inside a centered dark-glass frame with backdrop
 * click + ESC dismissal (matches the BorrowRepayModal convention).
 *
 * The form body owns the full PTB lifecycle, so this modal is
 * intentionally thin: just the frame, the title row, and the body.
 */

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownUp, X } from 'lucide-react';
import { LpProvisionFormBody, type LpProvisionFormBodyProps } from './LpProvisionFormBody';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const green = '#00E68A';

export interface LpProvisionModalProps {
  /** Parent-controlled open state. */
  open: boolean;
  onClose: () => void;
  /** Optional initial mode for the underlying form. */
  defaultMode?: LpProvisionFormBodyProps['defaultMode'];
}

export default function LpProvisionModal({
  open,
  onClose,
  defaultMode,
}: LpProvisionModalProps) {
  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
          key="lp-provision-modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10"
            style={{
              background: 'rgba(26, 29, 46, 0.96)',
              backdropFilter: 'blur(20px)',
            }}
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="lp-provision-modal-title"
          >
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

            <div className="relative z-10 p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2
                    id="lp-provision-modal-title"
                    className="text-base font-bold flex items-center gap-2"
                    style={{ color: textPrimary }}
                  >
                    <ArrowDownUp size={14} style={{ color: green }} />
                    LP provision
                  </h2>
                  <div
                    className="text-[11px] mt-1 font-mono"
                    style={{ color: textSecondary }}
                  >
                    DUSDC ↔ PLP via predict::supply / predict::withdraw
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

              {/* Body — full form lives in LpProvisionFormBody */}
              <LpProvisionFormBody {...(defaultMode ? { defaultMode } : {})} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
