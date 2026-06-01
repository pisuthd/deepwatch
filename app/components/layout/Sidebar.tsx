'use client';

import Link from 'next/link';
import {
  MessageSquare,
  LayoutDashboard,
  Settings,
  Timer,
  Home
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { categories, type PageId } from '../../types/navigation';

interface SidebarProps {
  activePage: PageId;
  onNavigate: (pageId: PageId) => void;
}

const iconMap: Record<string, typeof MessageSquare> = {
  MessageSquare,
  LayoutDashboard,
  Settings,
};

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { isDark } = useTheme();

  const textGradientClass = isDark ? 'text-gradient-white' : 'text-gradient-light';

  return (
    <aside className="w-[240px] bg-[var(--color-bg-surface)] border-r border-[var(--color-border-subtle)] flex flex-col shrink-0">
      {/* Brand */}
      <div className="px-6 pt-6 pb-8">
        <Link href="/" className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-accent-primary flex items-center justify-center shrink-0 shadow-[0_0_20px_var(--color-glow-green)]">
            <Timer size={24} className="text-[#0F1117]" strokeWidth={2} />
          </div>
          <div>
            <div className={`text-lg font-black tracking-widest leading-tight font-brand ${textGradientClass}`}>
              DeepWatch
            </div>
          </div>
        </Link>
      </div>

      {/* Home Link */}
      <div className="px-4 mb-4">
        <Link
          href="/"
          className={`flex items-center gap-3.5 w-full px-3.5 py-2.5 rounded-xl text-[15px] font-semibold transition-all hover:bg-[var(--color-sidebar-hover)]`}
        >
          <Home size={20} strokeWidth={1.8} className={textGradientClass} />
          <span className={textGradientClass}>Landing</span>
        </Link>
      </div>

      {/* Nav categories */}
      <nav className="flex-1 px-4 space-y-6 overflow-y-auto">
        {categories.map((category) => (
          <div key={category.title}>
            <div className="px-3 mb-2">
              <span className={`text-[11px] font-bold uppercase tracking-[0.2em] font-brand ${textGradientClass}`}>
                {category.title}
              </span>
            </div>
            <div className="space-y-1">
              {category.items.map(({ icon, label, pageId }) => {
                const Icon = iconMap[icon] || MessageSquare;
                const isActive = activePage === pageId;
                return (
                  <button
                    key={pageId}
                    onClick={() => onNavigate(pageId)}
                    className={`flex items-center gap-3.5 w-full px-3.5 py-2.5 rounded-xl text-[15px] font-semibold transition-all ${isActive
                      ? 'bg-accent-primary-dim'
                      : 'hover:bg-[var(--color-sidebar-hover)]'
                      }`}
                  >
                    <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} className={isActive ? 'text-accent-primary' : ''} />
                    <span className={isActive ? 'text-accent-primary' : textGradientClass}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Settings at bottom */}
      <div className="px-4 pb-5">
        <button
          onClick={() => onNavigate('settings')}
          className={`flex items-center gap-3.5 w-full px-3.5 py-2.5 rounded-xl text-[15px] font-semibold transition-all ${activePage === 'settings'
            ? 'bg-accent-primary-dim'
            : 'hover:bg-[var(--color-sidebar-hover)]'
            }`}
        >
          <Settings size={20} strokeWidth={activePage === 'settings' ? 2.2 : 1.8} className={activePage === 'settings' ? 'text-accent-primary' : ''} />
          <span className={activePage === 'settings' ? 'text-accent-primary' : textGradientClass}>Settings</span>
        </button>
      </div>
    </aside>
  );
}