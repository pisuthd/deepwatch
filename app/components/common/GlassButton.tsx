'use client';

import { ReactNode } from 'react';
import { useTheme } from '../../context/ThemeContext';

interface GlassButtonProps {
  icon?: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
  variant?: 'default' | 'danger' | 'success';
}

export default function GlassButton({ 
  icon, 
  onClick, 
  title, 
  className = '', 
  variant = 'default' 
}: GlassButtonProps) {
  const { isDark } = useTheme();

  const variantColors = {
    default: isDark
      ? 'hover:bg-white/5 text-gray-400 hover:text-white'
      : 'hover:bg-gray-50 text-gray-500 hover:text-gray-700',
    danger: isDark
      ? 'hover:bg-red-500/10 text-red-500 hover:text-red-400'
      : 'hover:bg-red-50 text-red-600 hover:text-red-700',
    success: isDark
      ? 'hover:bg-green-500/10 text-green-500 hover:text-green-400'
      : 'hover:bg-green-50 text-green-600 hover:text-green-700',
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border transition-all ${className} ${
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
        onClick={onClick}
        title={title}
        className={`relative z-10 px-3 py-2 flex items-center gap-2 transition-all ${
          variantColors[variant]
        }`}
      >
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {title && (
          <span className="text-sm font-medium whitespace-nowrap">{title}</span>
        )}
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
  );
}