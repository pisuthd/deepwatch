'use client';

import { useState, type ReactNode } from 'react';

export type TradeMode = 'simple' | 'advanced';

const OPTIONS: { value: TradeMode; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'advanced', label: 'Advanced' },
];

interface TradeWrapperProps {
  children: (mode: TradeMode) => ReactNode;
}

export default function TradeWrapper({ children }: TradeWrapperProps) {
  const [mode, setMode] = useState<TradeMode>('simple');
  const activeIndex = OPTIONS.findIndex((o) => o.value === mode);

  return (
    <div className="relative h-full">
      {children(mode)}

      <div className="absolute bottom-4 left-4 z-50 w-fit">
        <div className="relative flex items-center gap-0 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] overflow-hidden">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setMode(opt.value)}
              className="relative z-10 px-5 py-1.5 flex items-center justify-center min-w-[110px] text-xs font-semibold transition-all"
            >
              <span className={` ${mode === opt.value ? 'text-black' : 'text-gray-400'}`}>{opt.label}</span>
            </button>
          ))}
          <div
            className="absolute  top-0 h-full rounded-lg transition-all duration-200"
            style={{
              width: `${100 / OPTIONS.length}%`,
              background: 'var(--color-accent-primary)',
              transform: `translateX(${activeIndex * 100}%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
