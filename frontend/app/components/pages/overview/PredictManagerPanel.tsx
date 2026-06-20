'use client';

import { usePredict } from '../../../hooks/usePredict';
import PredictManagerContent from './PredictManagerContent';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

/**
 * Overview-page card wrapping `PredictManagerContent`. The inner content is
 * shared with `AccountOverviewPopover` on the Predict page; only the card
 * chrome and title bar live here.
 */
export default function PredictManagerPanel() {
  const { manager } = usePredict();

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-6 border border-white/10"
      style={{
        background: 'rgba(26, 29, 46, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

      <div className="relative z-10">
        <div className="mb-4">
          <h3 className="text-lg font-bold" style={{ color: textPrimary }}>Predict Account</h3>
          <p
            className="text-[11px] leading-relaxed mt-1"
            style={{ color: textSecondary }}
          >
            This is your DeepBook Predict trading account. DeepWatch
            auto-tops-up at bet time so you don't need to manually deposit
            here. But redeemable assets sit here for your further withdraw.
          </p>
        </div>

        <PredictManagerContent />
      </div>
    </div>
  );
}
