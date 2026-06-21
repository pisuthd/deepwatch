'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import HeroScreenshotCarousel from './HeroScreenshotCarousel';

export default function HeroSection() {
  return (
    <section className="relative  flex items-center justify-center overflow-hidden pt-32 md:pt-24 pb-4 md:pb-16 px-6">
      <div className="relative z-10 max-w-6xl mx-auto w-full">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">

          {/* Left: Content - Always visible */}
          <div className="text-center lg:text-left">

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-4xl md:text-5xl lg:text-6xl font-black mb-4 lg:mb-6 leading-tight"
            >
              <span className="text-white">Fast-Track to </span>
              <span className="bg-gradient-to-r from-accent-primary to-blue-400 bg-clip-text text-transparent">
                DeepBook
              </span>
              <br />
              <span className="text-white">Predict</span>
            </motion.h1>
            {/* Eyebrow — the punchy two-sentence setup */}
            <motion.p
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="text-base sm:text-lg text-gray-400 mb-3 lg:mb-4 max-w-lg mx-auto lg:mx-0 leading-relaxed"
            >
              Markets generate signals. AI generates opinions.
            </motion.p>

            {/* Subheadline — DeepWatch value prop, with green highlights on the
                5 impact words (product, differentiators, persistence). */}
            <motion.p
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-sm sm:text-base text-gray-400 mb-6 lg:mb-8 max-w-lg mx-auto lg:mx-0 leading-relaxed"
            >
              <span className="text-accent-primary font-bold">DeepWatch</span> turns cross-venue market data from{` `}
              <span className="text-accent-primary">DeepBook Predict</span>,<span> Polymarket, Kalshi, CoinMarketCap</span> into encrypted insights secured by{' '}
              <span className="text-accent-primary">Seal</span> and preserved on{' '}
              <span className="text-accent-primary">Walrus</span> via Tatum.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center lg:justify-start"
            >
              <Link
                href="/app"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-black font-semibold hover:bg-accent-primary-hover transition-all"
              >
                Launch App
                <ArrowRight size={16} />
              </Link>
              <Link
                href="https://github.com/pisuthd/deepwatch"
                target='_blank'
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-white/20 text-white font-medium hover:bg-white/5 transition-all"
              >
                View GitHub
              </Link>
            </motion.div>
          </div>

          {/* Right: Screenshots carousel - Hidden on mobile */}
          <HeroScreenshotCarousel />


        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="absolute bottom-4 lg:bottom-8 left-1/2 -translate-x-1/2"
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