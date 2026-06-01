'use client';

import { Search, Sun, Moon, ChevronRight } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { routeMeta, type PageId } from '../../types/navigation';

interface TopBarProps {
  activePage: PageId;
}

export default function TopBar({ activePage }: TopBarProps) {
  const { isDark, toggleTheme } = useTheme();

  // Build breadcrumb: Category > Page
  const meta = routeMeta[activePage] || { category: 'SnapPredict', label: 'Overview' };
  const breadcrumbItems = [
    { label: meta.category, pageId: activePage },
    { label: meta.label, pageId: activePage },
  ];

  return (
    <div className="flex items-center h-12 px-5 bg-[var(--color-topbar-bg)] backdrop-blur-md border-b border-[var(--color-border-subtle)] shrink-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        {breadcrumbItems.map((item, i) => (
          <span key={`${item.pageId}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={12} className="text-[var(--color-text-muted)]" />}
            <span
              className={`font-medium ${i === breadcrumbItems.length - 1
                  ? 'text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-muted)]'
                } transition-colors`}
            >
              {item.label}
            </span>
          </span>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] text-[var(--color-text-muted)] text-sm mr-3 hover:border-accent-primary/30 transition-colors cursor-pointer">
        <Search size={14} />
        <span>Search...</span>
        <div className="flex items-center gap-1 ml-4">
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border-default)]">
            Ctrl
          </kbd>
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border-default)]">
            K
          </kbd>
        </div>
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-sidebar-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      > {isDark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </div>
  );
}