'use client';

import { motion } from 'framer-motion';
import { Terminal, Sparkles, Table } from 'lucide-react';

export default function FeaturesSection() {

  const features = [
    {
      icon: Terminal,
      title: 'Cross-venue odds',
      description: 'Polymarket, Kalshi, and DeepBook Predict live odds in one terminal. Filter by strike, expiry, or implied probability.',
    },
    {
      icon: Sparkles,
      title: 'On-chain SVI surface',
      description: 'See the full implied-volatility curve straight from the DeepBook Predict oracle, not a stale index.',
    },
    {
      icon: Table,
      title: 'Local-first AI summaries',
      description: 'One-click structured analysis from live odds and SVI. Stored on your device — nothing uploaded.',
    },
  ];

  return (
    <section id="features" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl font-bold mb-4 text-gradient-white">
            Core Features
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Everything you need to trade smarter on DeepBook
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="relative rounded-2xl p-8 border border-white/10"
              style={{
                background: 'rgba(26, 29, 46, 0.6)',
                backdropFilter: 'blur(20px)',
              }}
            >
              <div className="w-14 h-14 rounded-xl bg-accent-primary/20 flex items-center justify-center mb-6">
                <feature.icon size={28} className="text-accent-primary" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
              <p className="text-gray-400">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
