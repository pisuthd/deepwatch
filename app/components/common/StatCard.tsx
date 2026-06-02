'use client';

import { motion } from 'framer-motion';

interface StatCardProps {
  label: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  accentColor?: 'primary' | 'blue' | 'purple';
}

const glowColors = {
  primary: 'bg-accent-primary/20',
  blue: 'bg-blue-500/20',
  purple: 'bg-purple-500/20',
};

export default function StatCard({ label, value, change, changeType = 'neutral', accentColor = 'primary' }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl p-5 bg-[rgba(26,29,46,0.6)] backdrop-blur-xl border border-white/10"
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent" />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full ${glowColors[accentColor]} blur-3xl opacity-20`} />
      
      <div className="relative z-10">
        <p className="text-sm text-gray-400 mb-2">{label}</p>
        <p className="text-3xl font-bold text-white">{value}</p>
        {change && (
          <p className={`text-sm mt-2 ${
            changeType === 'positive' ? 'text-accent-primary' :
            changeType === 'negative' ? 'text-red-400' : 'text-gray-400'
          }`}>
            {change}
          </p>
        )}
      </div>
    </motion.div>
  );
}