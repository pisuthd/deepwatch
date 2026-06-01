'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface Option {
  value: string;
  label: string;
}

interface GlassDropdownProps {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}

export default function GlassDropdown({ label, value, options, onChange }: GlassDropdownProps) {
  const { isDark } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative flex items-center gap-2" ref={dropdownRef}>
      <span className={`text-sm leading-none ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        {label}
      </span>
      <div
        className={`relative overflow-hidden rounded-xl border transition-all leading-none ${
          isDark
            ? 'border-white/10'
            : 'border-black/5 shadow-md'
        }`}
        style={{
          background: isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`relative z-10 flex items-center gap-2 px-3 py-2 transition-all ${
            isDark
              ? 'hover:bg-white/5 text-white'
              : 'hover:bg-gray-50 text-gray-900'
          }`}
        >
          <span className="text-sm font-medium">{selectedOption?.label || 'Select...'}</span>
          <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {/* Glass shine */}
        <div className={`absolute inset-0 rounded-xl ${
          isDark
            ? 'bg-gradient-to-br from-white/5 to-transparent'
            : 'bg-gradient-to-br from-white/80 to-transparent'
        }`} />
        <div className={`absolute top-0 left-0 w-full h-px ${
          isDark
            ? 'bg-gradient-to-r from-transparent via-white/20 to-transparent'
            : 'bg-gradient-to-r from-transparent via-black/10 to-transparent'
        }`} />
      </div>

      {isOpen && (
        <div
          className={`absolute top-full mt-2 min-w-[160px] rounded-xl border overflow-hidden z-50 ${
            isDark
              ? 'bg-[#1a1d2e] border-white/10'
              : 'bg-white border-black/5 shadow-lg'
          }`}
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                option.value === value
                  ? isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'
                  : isDark ? 'text-gray-400 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}