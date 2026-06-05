'use client';

import { X } from 'lucide-react';
import { usePredict } from '../../../hooks/usePredict';
import PredictManagerContent from '../overview/PredictManagerContent';

interface AccountOverviewPopoverProps {
  onClose: () => void;
}

const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

/**
 * Popover version of the Predict Manager. Reuses `PredictManagerContent`
 * (the same component mounted inline on the Overview page) so both surfaces
 * stay in lockstep.
 */
export default function AccountOverviewPopover({ onClose }: AccountOverviewPopoverProps) {
  const { manager, summary } = usePredict();
  const tradingBalance = summary ? Number(summary.trading_balance) / 1e6 : 0;

  return (
    <div
      className="absolute bottom-full mb-2 right-0 z-40 w-[460px] max-h-[80vh] overflow-y-auto rounded-2xl border border-white/10"
      style={{
        background: 'rgba(26, 29, 46, 0.95)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5"
        style={{ background: 'rgba(26, 29, 46, 0.95)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: textPrimary }}>
            Account Overview
          </h3>
          {!!manager && (
            <span className="text-[10px] font-mono" style={{ color: textSecondary }}>
              {tradingBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} DBUSDC
            </span>
          )}
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
      <div className="relative z-10 p-4">
        <PredictManagerContent />
      </div>
    </div>
  );
}
