'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  accentColor?: 'green' | 'blue' | 'purple';
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accentColor = 'green'
}: StatCardProps) {

  const isDark = true

  const glowColors = {
    green: 'bg-accent-primary',
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
  };


  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-2xl p-6 ${isDark
        ? 'border border-white/10'
        : 'border border-black/5 shadow-lg'
        }`}
      style={{
        background: isDark
          ? 'rgba(26, 29, 46, 0.6)'
          : 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Glass shine effect */}
      <div className={`absolute inset-0 rounded-2xl ${isDark
        ? 'bg-gradient-to-br from-white/5 to-transparent'
        : 'bg-gradient-to-br from-white/80 to-transparent'
        }`} />

      {/* Top highlight */}
      <div className={`absolute top-0 left-0 w-full h-px ${isDark
        ? 'bg-gradient-to-r from-transparent via-white/20 to-transparent'
        : 'bg-gradient-to-r from-transparent via-black/10 to-transparent'
        }`} />

      {/* Colored accent glow */}
      <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full ${glowColors[accentColor]} blur-3xl ${isDark ? 'opacity-20' : 'opacity-15'}`} />

      <div className="flex items-start justify-between relative z-10">
        <div className="flex-1">
          <p className={`text-sm mb-1 ${isDark ? 'text-[var(--color-text-muted)]' : 'text-gray-500'}`}>{title}</p>
          <p className={`text-2xl font-bold mb-1 ${isDark ? 'text-[var(--color-text-primary)]' : 'text-gray-900'}`}>{value}</p>
          {subtitle && (
            <p className={`mb-4 text-sm ${isDark ? 'text-[var(--color-text-secondary)]' : 'text-gray-600'}`}>{subtitle}</p>
          )}
          <Link
            href="https://tally.so/r/Xx102L"
            className="inline-flex items-center gap-1.5 font-semibold text-sm transition-colors text-accent-primary hover:text-accent-primary-hover"
          >
            Request Testnet DUSD
            <ArrowRight size={14} />
          </Link>
        </div>

        {/* Icon with blur glow circle */}
        <div className="relative w-14 h-14 flex items-center justify-center">
          {/* Blur glow circle behind */}
          <div className={`absolute inset-0 rounded-2xl ${glowColors[accentColor]} blur-xl ${isDark ? 'opacity-40' : 'opacity-25'}`} />
          {/* Solid circle */}
          <div className={`absolute inset-0 rounded-2xl ${isDark ? 'bg-[var(--color-bg-elevated)]' : 'bg-white'} ${isDark ? 'border border-white/10' : 'border border-black/10'} shadow-sm`} />
          {/* Icon */}
          <Icon size={24} className={`relative z-10 ${isDark ? 'text-white' : 'text-gray-700'}`} />
        </div>
      </div>
    </motion.div>
  );
}