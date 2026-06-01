'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useTheme } from '../../context/ThemeContext';

export default function CTASection() {
  const { isDark } = useTheme();

  return (
    <section className="py-24 px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className={`max-w-xl mx-auto rounded-2xl p-8 text-center ${isDark ? 'border border-white/10' : 'border border-black/5 shadow-lg'}`}
        style={{
          background: isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(20px)',
        }}
      >
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">
          Ready to get started?
        </h2>
        <p className="text-gray-400 mb-8">
          DeepWatch aggregates signals from multiple sources so you can make informed decisions on DeepBook Predict markets.
        </p>
        <Link
          href="/app"
          className="inline-flex items-center justify-center px-8 py-3 rounded-xl bg-accent-primary text-black font-semibold hover:bg-accent-primary-hover transition-all"
        >
          Open Dashboard
        </Link>
      </motion.div>
    </section>
  );
}