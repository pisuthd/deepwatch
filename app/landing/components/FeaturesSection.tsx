'use client';

import { motion } from 'framer-motion';
import { Terminal, Sparkles, Database } from 'lucide-react';

export default function FeaturesSection() {

  const features = [
    {
      icon: Terminal,
      title: 'DeepBook Terminal',
      description: 'Trade spot, margin, and predict markets in one unified interface with AI insights.',
    },
    {
      icon: Sparkles,
      title: 'AI-Powered Analysis',
      description: 'SVI data + Polymarket + Kalshi odds distilled into human-readable insights via Tatum API.',
    },
    {
      icon: Database,
      title: 'Walrus Storage',
      description: 'All insights permanently archived on-chain for verifiable historical record.',
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
