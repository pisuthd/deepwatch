'use client';

import { usePredict } from '../../../hooks/usePredict';
import PredictManagerContent from './PredictManagerContent';

const green = '#00E68A';
const textPrimary = '#ffffff';

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
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold" style={{ color: textPrimary }}>Predict Manager</h3>
          {!!manager && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(0,230,138,0.08)', color: green }}
            >
              Connected
            </span>
          )}
        </div>

        <PredictManagerContent />
      </div>
    </div>
  );
}
