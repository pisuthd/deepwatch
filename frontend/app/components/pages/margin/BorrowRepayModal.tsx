'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useMargin } from '../../../hooks/useMargin';
import { useToast } from '../../../context/ToastContext';

interface BorrowRepayModalProps {
  poolKey: string;
  managerId: string;
  poolLabel: string;
  onClose: () => void;
}

type Mode = 'borrow' | 'repay';

const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';
const textMuted = '#6b7280';

/**
 * Modal that drives a single borrow-or-repay Move call against the user's
 * MarginManager. Used as a quick action from the Simple/Advanced mode
 * dashboards and the MarginManagerPopover.
 */
export default function BorrowRepayModal({
  poolKey,
  managerId,
  poolLabel,
  onClose,
}: BorrowRepayModalProps) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const { borrowQuote, repayQuote } = useMargin();
  const { notify } = useToast();

  const [mode, setMode] = useState<Mode>('borrow');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsed = parseFloat(amount) || 0;
  const valid = parsed > 0;

  const handleSubmit = async () => {
    if (!account || !dAppKit?.signAndExecuteTransaction || !valid) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'borrow') {
        await borrowQuote(dAppKit.signAndExecuteTransaction, managerId, poolKey, parsed);
        notify(`Borrowed ${parsed} quote · ${poolLabel}`, { variant: 'success' });
      } else {
        await repayQuote(dAppKit.signAndExecuteTransaction, managerId, poolKey, parsed);
        notify(`Repaid ${parsed} quote · ${poolLabel}`, { variant: 'success' });
      }
      onClose();
    } catch (e: any) {
      setError(e?.message ?? `${mode === 'borrow' ? 'Borrow' : 'Repay'} failed`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/10"
        style={{
          background: 'rgba(26, 29, 46, 0.95)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
              {mode === 'borrow' ? 'Borrow' : 'Repay'} Quote
            </h3>
            <p className="text-[10px] mt-0.5 font-mono" style={{ color: textMuted }}>
              {poolLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: textSecondary }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="relative p-5 space-y-4">
          {/* Mode toggle */}
          <div
            className="inline-flex rounded-lg overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {(['borrow', 'repay'] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setAmount('');
                  setError(null);
                }}
                className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors"
                style={{
                  background: mode === m ? green : 'transparent',
                  color: mode === m ? '#000' : textSecondary,
                }}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Amount input */}
          <div>
            <label className="text-[10px] uppercase tracking-wide" style={{ color: textSecondary }}>
              Amount (quote)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="w-full mt-1 px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 text-sm font-mono text-white outline-none focus:border-white/30"
            />
          </div>

          {error && (
            <div
              className="rounded-md p-2.5 text-xs"
              style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5' }}
            >
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || !valid || !account}
            className="w-full py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: valid ? green : 'rgba(255,255,255,0.08)', color: valid ? '#000' : textMuted }}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? 'Signing…' : `${mode === 'borrow' ? 'Borrow' : 'Repay'} ${valid ? parsed : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
