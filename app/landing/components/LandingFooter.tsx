'use client';

import { Timer } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

export default function LandingFooter() {
  const { isDark } = useTheme();

  return (
    <footer className="py-8 px-6 border-t border-[var(--color-border-subtle)]">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent-primary flex items-center justify-center">
            <Timer size={16} className="text-black" />
          </div>
          <span className={`font-brand text-sm tracking-widest ${isDark ? 'text-gradient-white' : 'text-gradient-light'}`}>
            DeepWatch
          </span>
        </div>
        <p className="text-gray-500 text-sm">
          Powered by DeepBook Predict • Tatum • Walrus • Sui
        </p>
      </div>
    </footer>
  );
}