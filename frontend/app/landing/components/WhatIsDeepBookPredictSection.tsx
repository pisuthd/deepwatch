'use client';

import { motion } from 'framer-motion';
import { ExternalLink } from 'lucide-react'; 

export default function WhatIsDeepBookPredictSection() { 

  return (
    <section id="what-is-deepbook-predict" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className={`text-4xl font-bold mb-4 ${true ? 'text-gradient-white' : 'text-gradient-light'}`}>
            What is DeepBook Predict?
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            A high-performance prediction market infrastructure from Sui team
          </p>
        </motion.div>

        {/* Single Center Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className={`max-w-xl mx-auto rounded-2xl p-8 ${true ? 'border border-white/10' : 'border border-black/5 shadow-lg'}`}
          style={{
            background: true ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <div className="text-gray-300 space-y-4">
            <p className="text-lg">
              Unlike traditional prediction platforms, <span className="text-accent-primary font-semibold">DeepBook Predict</span> is designed with:
            </p>
            <ul className="space-y-3 text-base text-gray-300">
              <li className="flex items-start gap-3">
                <span className="text-accent-primary font-bold text-xl mt-[-2px]">•</span>
                <span>Block Scholes oracle for institutional pricing</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-accent-primary font-bold text-xl mt-[-2px]">•</span>
                <span>Sub-400ms settlement — fast enough to feel like a game</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-accent-primary font-bold text-xl mt-[-2px]">•</span>
                <span>Internal market maker provides liquidity from day one</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-accent-primary font-bold text-xl mt-[-2px]">•</span>
                <span>All positions composable with deep shared liquidity</span>
              </li>
            </ul>
            <p className="text-gray-400">
              <span className="text-accent-primary font-semibold">DeepWatch</span>{` `}surfaces Predict alongside Polymarket, Kalshi, so you see every venue&apos;s price for the same event in one place.
            </p>
          </div>
        </motion.div>

        {/* Link to Docs */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center mt-10"
        >
          <a
            href="https://docs.sui.io/onchain-finance/deepbook-predict"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-accent-primary hover:text-accent-primary-hover transition-colors"
          >
            Learn more about DeepBook Predict
            <ExternalLink size={16} />
          </a>
        </motion.div>
      </div>
    </section>
  );
}