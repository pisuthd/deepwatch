'use client';

import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import type { PageId } from '../../types/navigation';

interface WelcomeCardProps {
  onNavigate: (pageId: PageId) => void;
}

export default function WelcomeCard({ onNavigate }: WelcomeCardProps) {
  const { isDark } = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-2xl p-6 md:col-span-2 ${
        isDark
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
      <div className={`absolute inset-0 rounded-2xl ${
        isDark
          ? 'bg-gradient-to-br from-white/5 to-transparent'
          : 'bg-gradient-to-br from-white/80 to-transparent'
      }`} />

      {/* Top highlight */}
      <div className={`absolute top-0 left-0 w-full h-px ${
        isDark
          ? 'bg-gradient-to-r from-transparent via-white/20 to-transparent'
          : 'bg-gradient-to-r from-transparent via-black/10 to-transparent'
      }`} />

      {/* Colored accent glow */}
      <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full bg-accent-primary blur-3xl ${isDark ? 'opacity-20' : 'opacity-15'}`} />

      <div className="flex items-start justify-between relative z-10">
        <div className="flex-1">
          <h2 className={`text-xl font-bold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Welcome to SnapPredict
          </h2>
          <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Your AI-powered prediction platform. Get started by exploring the features below.
          </p>

          <button
            onClick={() => onNavigate('chat')}
            className={`inline-flex items-center gap-2 font-medium text-sm transition-colors text-accent-primary hover:text-accent-primary/80`}
          >
            Start Chat
          </button>
          <button
            onClick={() => onNavigate('overview')}
            className={`ml-4 inline-flex items-center gap-2 font-medium text-sm transition-colors text-accent-primary hover:text-accent-primary/80`}
          >
            View Overview
          </button>
        </div>

        {/* Icon with blur glow circle */}
        <div className="relative w-14 h-14 flex items-center justify-center">
          {/* Blur glow circle behind */}
          <div className={`absolute inset-0 rounded-2xl bg-accent-primary blur-xl ${isDark ? 'opacity-40' : 'opacity-25'}`} />
          {/* Solid circle */}
          <div className={`absolute inset-0 rounded-2xl ${isDark ? 'bg-[var(--color-bg-elevated)]' : 'bg-white'} ${isDark ? 'border border-white/10' : 'border border-black/10'} shadow-sm`} />
          {/* Icon */}
          <Zap size={24} className={`relative z-10 ${isDark ? 'text-white' : 'text-gray-700'}`} />
        </div>
      </div>
    </motion.div>
  );
}