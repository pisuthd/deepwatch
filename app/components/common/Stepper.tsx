'use client';

import { Check } from 'lucide-react';

export interface StepDef {
  id: number;
  label: string;
}

interface Props {
  steps: StepDef[];
  current: number;
  furthestVisited: number;
  onSelect: (id: number) => void;
}

const green = '#00E68A';
const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

/**
 * Stepper — horizontal step indicator with completion-aware styling.
 *
 *  - Completed steps: green dot with checkmark, clickable (jump back).
 *  - Current step: white dot with the number, clickable.
 *  - Future steps: muted, not clickable (until visited).
 *
 * The wizard tracks the furthest step the user has reached via
 * `furthestVisited` so the user can freely jump back to any prior
 * step but cannot skip ahead.
 */
export default function Stepper({ steps, current, furthestVisited, onSelect }: Props) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1">
      {steps.map((s, i) => {
        const completed = s.id <= furthestVisited && s.id !== current;
        const active = s.id === current;
        const reachable = s.id <= furthestVisited;

        return (
          <div key={s.id} className="flex items-center gap-2">
            <button
              onClick={() => reachable && onSelect(s.id)}
              disabled={!reachable}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: active ? textPrimary : reachable ? textSecondary : 'rgba(156,163,175,0.4)',
                cursor: reachable ? 'pointer' : 'not-allowed',
                border: 'none',
              }}
            >
              <span
                className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
                style={{
                  background: completed ? green : active ? textPrimary : 'rgba(255,255,255,0.08)',
                  color: completed || active ? '#000' : textSecondary,
                }}
              >
                {completed ? <Check size={12} /> : s.id}
              </span>
              <span className="whitespace-nowrap">{s.label}</span>
            </button>
            {i < steps.length - 1 && (
              <span
                className="w-6 h-px"
                style={{ background: completed ? green : 'rgba(255,255,255,0.08)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
