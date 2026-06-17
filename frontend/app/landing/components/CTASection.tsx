'use client';

import { motion } from 'framer-motion';
import { ArrowRight, ExternalLink, Sparkles } from 'lucide-react';
import Link from 'next/link';

export default function CTASection() {
  return (
    <section className="py-24 px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="relative max-w-xl mx-auto"
      >
        {/* Outer glow — same gradient + blur language as the hero carousel */}
        <div className="absolute inset-0 bg-gradient-to-br from-accent-primary/20 via-transparent to-blue-500/20 rounded-3xl blur-3xl" />
        {/* Accent orb top-right — matches the hero's decorative orb */}
        <div className="absolute -top-4 -right-4 w-20 h-20 bg-accent-primary/10 rounded-full blur-2xl" />

        <div
          className="relative rounded-2xl p-8 text-center border border-white/10"
          style={{
            background: 'rgba(26, 29, 46, 0.6)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {/* AI signal — same Sparkles + animate-pulse vocabulary as the
              hero's "AI Insight" indicator and the in-app InsightButton. */}
          <div className="flex items-center justify-center gap-1.5 mb-4">
            <Sparkles size={12} className="text-accent-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-primary">
              Odds + SVI + AI
            </span>
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: 'var(--color-accent-primary)' }}
            />
          </div>

          <h2 className="text-2xl md:text-3xl font-bold text-gradient-white mb-4">
            Skip the noise. See the signal.
          </h2>
          <p className="text-gray-400 mb-8">
            Polymarket, Kalshi, and DeepBook Predict live odds side by side. One-click AI summaries when you want context.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/app"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-black font-semibold hover:bg-accent-primary-hover transition-all"
            >
              Launch App
              <ArrowRight size={16} />
            </Link>
            <a
              href="https://github.com/pisuthd/deepwatch"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/20 text-white font-medium hover:bg-white/5 transition-all"
            >
              GitHub Repo
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
