'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface Option {
  value: string;
  label: string;
}

interface GlassDropdownProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function GlassDropdown({ options, value, onChange, placeholder = 'Select...' }: GlassDropdownProps) {
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
        
        <span className="relative z-10 text-sm leading-none text-gray-300">
          {selected?.label || placeholder}
        </span>
        
        <span className="relative z-10 flex items-center gap-2">
          <span className="text-xs text-gray-500">{selected?.value || ''}</span>
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
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-gray-500">{option.value}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}