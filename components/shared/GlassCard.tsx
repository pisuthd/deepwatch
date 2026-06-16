import type { ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  /**
   * Overflow behavior. Defaults to `'hidden'` so the inner gradient overlays
   * stay clipped to the rounded corners. Pass `'visible'` for cards that
   * host popovers, dropdowns, or any other content that should escape the
   * card boundary.
   */
  overflow?: 'hidden' | 'visible';
}

export default function GlassCard({
  children,
  className = '',
  overflow = 'hidden',
}: GlassCardProps) {
  return (
    <div
      className={`relative rounded-2xl p-5 border border-white/10 ${className}`}
      style={{
        background: 'rgba(26, 29, 46, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        overflow,
      }}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
