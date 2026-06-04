import type { ReactNode } from 'react';
import GlassCard from '../../common/GlassCard';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

interface Props {
  number: number;
  title: string;
  description: string;
  children: ReactNode;
}

/**
 * Shared step chrome — a `GlassCard` with a step number, a heading,
 * a one-paragraph description, and the step's body content below.
 * Generous padding to give each beat breathing room.
 *
 * `overflow: 'visible'` so dropdown panels (e.g. the asset picker on
 * step 1, the oracle dropdown on step 2) can extend past the card's
 * bottom edge instead of being clipped by the default `overflow: hidden`.
 */
export default function StepHeader({ number, title, description, children }: Props) {
  return (
    <GlassCard className="p-8" overflow="visible">
      <div className="flex items-start gap-4">
        <div
          className="flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold flex-shrink-0"
          style={{
            background: 'rgba(255,255,255,0.08)',
            color: textPrimary,
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold" style={{ color: textPrimary }}>
            {title}
          </h2>
          <p className="text-sm mt-1" style={{ color: textSecondary }}>
            {description}
          </p>
        </div>
      </div>
      <div className="mt-8">{children}</div>
    </GlassCard>
  );
}
