'use client';

/**
 * Tabs — minimal accessible tablist primitive.
 *
 * Visual: single rounded container with dark-glass background. Active
 * tab is filled with the accent green and carries black text. A single
 * shared `motion.div` with `layoutId="tab-active"` slides between
 * active tabs (framer-motion `layout` animation), so the active pill
 * animates smoothly between switches without per-tab animation state.
 *
 * Accessibility (WAI-ARIA tabs pattern):
 *   - Outer `<div role="tablist" aria-label={ariaLabel}>`.
 *   - Each button: `role="tab"`, `aria-selected`, `aria-controls`.
 *   - Keyboard: ArrowLeft / ArrowRight cycle, Home / End jump to ends,
 *     Tab exits naturally.
 *   - The `TabPanel` wrapper exposes `role="tabpanel"`,
 *     `aria-labelledby` pointing back at the active tab.
 *
 * Generic over the tab id type so callers can use a string-literal
 * union and get exhaustive checks on `active` / `onChange`.
 */

import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

const textSecondary = '#9ca3af';
const green = '#00E68A';

export interface Tab<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** Optional badge (e.g. "2" for an item count). Rendered as a small
   *  monospace chip next to the label. */
  badge?: string | number;
}

export interface TabsProps<T extends string> {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
  /** ARIA label for the tablist. Required for accessibility. */
  ariaLabel: string;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className = '',
  ariaLabel,
}: TabsProps<T>) {
  const tabRefs = useRef<Map<T, HTMLButtonElement | null>>(new Map());

  const focusTab = useCallback((id: T) => {
    const el = tabRefs.current.get(id);
    if (el) el.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const ids = tabs.map((t) => t.id);
      const currentIndex = ids.indexOf(active);
      if (currentIndex === -1) return;
      let nextIndex: number | null = null;
      switch (e.key) {
        case 'ArrowLeft':
          nextIndex = currentIndex === 0 ? ids.length - 1 : currentIndex - 1;
          break;
        case 'ArrowRight':
          nextIndex = currentIndex === ids.length - 1 ? 0 : currentIndex + 1;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = ids.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      const nextId = ids[nextIndex];
      onChange(nextId);
      focusTab(nextId);
    },
    [active, tabs, onChange, focusTab],
  );

  return (
    <div
      className={`inline-flex items-center rounded-lg p-0.5 gap-0.5 ${className}`}
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) {
                tabRefs.current.set(tab.id, el);
              } else {
                // Drop the entry on unmount / tab removal so the map
                // doesn't grow unbounded if `tabs` changes over time.
                tabRefs.current.delete(tab.id);
              }
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className="relative px-3.5 py-1.5 rounded-md text-sm font-semibold inline-flex items-center gap-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            style={{
              color: isActive ? '#000' : textSecondary,
            }}
          >
            {isActive && (
              <motion.span
                layoutId="tab-active-pill"
                className="absolute inset-0 rounded-md"
                style={{ background: green, zIndex: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-2">
              {Icon && <Icon size={14} />}
              {tab.label}
              {tab.badge != null && (
                <span
                  className="text-[10px] font-mono px-1 rounded"
                  style={{
                    background: isActive
                      ? 'rgba(0,0,0,0.18)'
                      : 'rgba(255,255,255,0.06)',
                    color: isActive ? '#000' : textSecondary,
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  /** id of the active tab — used to build the `aria-labelledby` link. */
  activeId: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ activeId, children, className = '' }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${activeId}`}
      aria-labelledby={`tab-${activeId}`}
      className={className}
    >
      {children}
    </div>
  );
}

