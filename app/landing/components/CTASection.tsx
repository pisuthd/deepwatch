'use client';

import { motion } from 'framer-motion';
import { Zap, Clock } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from '../../context/ThemeContext';

export default function CTASection() {
  const { isDark } = useTheme();

  return (
    <section className="py-24 px-6">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className={`relative rounded-3xl overflow-hidden p-12 text-center ${isDark ? 'border border-white/10' : 'border border-black/5 shadow-lg'}`}
          style={{
            background: isDark ? 'rgba(26, 29, 46, 0.8)' : 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(30px)',
          }}
        >
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-accent-primary rounded-full blur-[100px] opacity-30" />
          
          <div className="relative z-10">
            <Clock size={48} className="text-accent-primary mx-auto mb-6" />
            <h2 className={`text-3xl md:text-4xl font-bold mb-4 ${isDark ? 'text-gradient-brand' : 'text-gradient-light'}`}>
              Time-Sensitive Markets Wait for No One
            </h2>
            <p className="text-gray-400 text-lg mb-8 max-w-2xl mx-auto">
              Start using SnapPredict now and get real-time aggregated signals for imminent BTC markets. 
              Make faster decisions with institutional-grade data.
            </p>
            <Link
              href="/app"
              className="inline-flex items-center justify-center gap-2 px-10 py-5 rounded-xl bg-accent-primary text-black font-bold text-xl hover:bg-accent-primary-hover transition-all shadow-[0_0_40px_var(--color-glow-green)]"
            >
              <Zap size={24} />
              Launch Dashboard
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}