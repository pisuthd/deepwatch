'use client';

import { motion } from 'framer-motion';
import { Clock, BarChart3, Database, Archive, Link2, Shield } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

export default function FeaturesSection() {
  const { isDark } = useTheme();

  const features = [
    {
      icon: Clock,
      title: 'Live Dashboard',
      description: 'Markets filtered by expiry (<2h / <4h / <6h) with real-time countdown timers and instant updates.',
    },
    {
      icon: BarChart3,
      title: 'Market Comparison',
      description: 'Side-by-side comparison of DeepBook Predict, Polymarket, and Kalshi with unified probability signals.',
    },
    {
      icon: Database,
      title: 'Walrus Snapshots',
      description: 'Automatic periodic snapshots stored permanently on Walrus for verifiable historical archive.',
    },
    {
      icon: Archive,
      title: 'Archive Page',
      description: 'Browse past resolved markets with full data restored from decentralized storage.',
    },
    {
      icon: Link2,
      title: 'One-Click Trading',
      description: 'Direct links to mint positions on DeepBook Predict. Trade faster, decide smarter.',
    },
    {
      icon: Shield,
      title: 'Raw Oracle Toggle',
      description: 'Show technical SVI/Block Scholes data for advanced users who want deeper insights.',
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
          <h2 className={`text-4xl font-bold mb-4 ${isDark ? 'text-gradient-white' : 'text-gradient-light'}`}>
            Core Features
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Everything you need to make informed decisions on short-expiry BTC markets
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className={`relative rounded-2xl p-6 group ${isDark ? 'border border-white/10' : 'border border-black/5 shadow-lg'}`}
              style={{
                background: isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                backdropFilter: 'blur(20px)',
              }}
            >
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative z-10">
                <div className="w-12 h-12 rounded-xl bg-accent-primary/20 flex items-center justify-center mb-4">
                  <feature.icon size={24} className="text-accent-primary" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{feature.title}</h3>
                <p className="text-gray-400 text-sm">{feature.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}