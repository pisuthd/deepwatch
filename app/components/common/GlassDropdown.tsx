'use client';

import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

const green = '#00E68A';

interface Option {
  value: string;
  label: string;
  /**
   * Optional short tag rendered as a small pill on the right side of
   * the option in both the closed trigger and the open panel. Used
   * e.g. by the predict market dropdown to mark the "closest to 1d
   * expiry" market.
   */
  badge?: string;
  /**
   * Optional icon URL rendered as a small round image to the left of
   * the label in both the closed trigger and the open panel. Used by
   * the asset picker in Step 1. Non-asset dropdowns (e.g. the predict
   * oracle id picker) leave this unset and the dropdown renders the
   * label only.
   */
  icon?: string;
}

interface GlassDropdownProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Whether to show the right-hand `value` column (the option's `value`
   * field, typically a backend id) in the closed trigger and the open
   * panel. Defaults to `true`; set `false` for dropdowns where the id
   * is an internal identifier the user doesn't need to see (e.g. the
   * predict oracle id — the expiry label is the meaningful signal).
   */
  showValue?: boolean;
  /**
   * If true, never render an icon column even if the selected option
   * provides one. Default false. (Reserved for non-asset dropdowns
   * that may later pass icons in by mistake — currently unused.)
   */
  hideIcon?: boolean;
}

export default function GlassDropdown({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  showValue = true,
  hideIcon = false,
}: GlassDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-[rgba(26,29,46,0.6)] backdrop-blur-xl border border-white/10"
      >
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/5 to-transparent" />
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <span className="relative z-10 flex items-center gap-2 min-w-0">
          {!hideIcon && selected?.icon && (
            <Image
              src={selected.icon}
              alt=""
              width={14}
              height={14}
              className="rounded-full flex-shrink-0"
              unoptimized
            />
          )}
          <span className="text-sm leading-none text-gray-300 truncate">
            {selected?.label || placeholder}
          </span>
        </span>

        <span className="relative z-10 flex items-center gap-2">
          {selected?.badge && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: 'rgba(0,230,138,0.15)', color: green }}
            >
              {selected.badge}
            </span>
          )}
          {showValue && (
            <span className="text-xs text-gray-500">{selected?.value || ''}</span>
          )}
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 py-1 rounded-xl bg-[rgba(26,29,46,0.95)] backdrop-blur-xl border border-white/10 z-50 overflow-hidden">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-2.5 text-left transition-all ${
                option.value === value
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  {!hideIcon && option.icon && (
                    <Image
                      src={option.icon}
                      alt=""
                      width={16}
                      height={16}
                      className="rounded-full flex-shrink-0"
                      unoptimized
                    />
                  )}
                  <span className="text-sm font-medium truncate">{option.label}</span>
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  {option.badge && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                      style={{ background: 'rgba(0,230,138,0.15)', color: green }}
                    >
                      {option.badge}
                    </span>
                  )}
                  {showValue && (
                    <span className="text-xs text-gray-500">{option.value}</span>
                  )}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}