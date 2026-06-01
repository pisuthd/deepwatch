'use client';

import { motion } from 'framer-motion';
import { TrendingUp, ArrowRight, Clock, Database, BarChart3 } from 'lucide-react';
import Link from 'next/link';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-24 pb-16">
      <div className="relative z-10 max-w-7xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          
          {/* Left: Content */}
          <div className="text-left"> 

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-4xl md:text-5xl lg:text-6xl font-black mb-6 leading-tight"
            >
              <span className="text-white">Fast-Track to </span>
              <span className="bg-gradient-to-r from-accent-primary to-blue-400 bg-clip-text text-transparent">
                DeepBook
              </span>
              <br />
              <span className="text-white">Predict</span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg text-gray-400 mb-8 max-w-lg leading-relaxed"
            > 
             Get started with DeepBook Predict more simply with AI-curated insights from Polymarket and Kalshi via Tatum APIs, while every market snapshot is archived on Walrus
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex gap-4"
            >
              <Link
                href="/app"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-black font-semibold hover:bg-accent-primary-hover transition-all shadow-[0_0_20px_rgba(0,230,138,0.3)]"
              > 
                Get Started
                <ArrowRight size={16} />
              </Link>
              <Link
                href="#features"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/20 text-white font-medium hover:bg-white/5 transition-all"
              >
                Learn More
              </Link>
            </motion.div>
 
          </div>

          {/* Right: Abstract Visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="hidden lg:block"
          >
            <div className="relative">
              {/* Main glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-accent-primary/20 via-transparent to-blue-500/20 rounded-3xl blur-3xl" />
              
              {/* Content card */}
              <div className="relative bg-[var(--color-bg-surface)] border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-accent-primary/20 flex items-center justify-center">
                      <BarChart3 size={20} className="text-accent-primary" />
                    </div>
                    <div>
                      <p className="text-white font-semibold">BTC {'>'} $100k</p>
                      <p className="text-xs text-gray-500">Exp in 2h 34m</p>
                    </div>
                  </div>
                  <div className="px-3 py-1 rounded-full bg-accent-primary/20">
                    <span className="text-sm font-bold text-accent-primary">78%</span>
                  </div>
                </div>

                {/* Mini chart */}
                <div className="h-32 relative mb-6">
                  <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00E68A" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#00E68A" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {/* Area fill */}
                    <path
                      d="M0,80 L50,65 L100,70 L150,50 L200,45 L250,35 L300,25 L300,100 L0,100 Z"
                      fill="url(#chartFill)"
                    />
                    {/* Line */}
                    <polyline
                      fill="none"
                      stroke="#00E68A"
                      strokeWidth="2"
                      points="0,80 50,65 100,70 150,50 200,45 250,35 300,25"
                    />
                    {/* Data points */}
                    {[50, 150, 250].map((x, i) => (
                      <circle
                        key={i}
                        cx={x}
                        cy={[65, 50, 35][i]}
                        r="4"
                        fill="#00E68A"
                        stroke="#0F1117"
                        strokeWidth="2"
                      />
                    ))}
                  </svg>
                </div>

                {/* Sources */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { name: 'DeepBook', prob: '76%', color: 'accent-primary' },
                    { name: 'Polymarket', prob: '79%', color: 'blue-500' },
                    { name: 'Kalshi', prob: '80%', color: 'purple-500' },
                  ].map((source) => (
                    <div key={source.name} className="bg-[var(--color-bg-elevated)] rounded-xl p-3 text-center">
                      <p className="text-xs text-gray-500 mb-1">{source.name}</p>
                      <p className={`text-sm font-bold text-${source.color}`}>{source.prob}</p>
                    </div>
                  ))}
                </div>

                {/* Walrus badge */}
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-500">
                  <Database size={12} />
                  <span>Archived on Walrus</span>
                </div>
              </div>

              {/* Decorative elements */}
              <div className="absolute -top-4 -right-4 w-24 h-24 bg-accent-primary/10 rounded-full blur-xl" />
              <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-blue-500/10 rounded-full blur-xl" />
            </div>
          </motion.div>

        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <div className="w-5 h-8 rounded-full border border-gray-600 flex justify-center pt-1">
          <motion.div
            animate={{ y: [0, 4, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-1 h-1 rounded-full bg-gray-500"
          />
        </div>
      </motion.div>
    </section>
  );
}