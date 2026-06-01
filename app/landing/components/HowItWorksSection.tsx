'use client';

import { motion } from 'framer-motion';
import { useTheme } from '../../context/ThemeContext';

export default function HowItWorksSection() {
  const { isDark } = useTheme();

  const steps = [
    {
      step: '01',
      title: 'One Unified View',
      description:
        'Collect signals from Polymarket and Kalshi via Tatum APIs to inform your next trade on DeepBook Predict.',
    },
    {
      step: '02',
      title: 'Read Insights',
      description:
        'Skip SVI technical market data. Read human-readable insights generated and shared on Walrus.',
    },
    {
      step: '03',
      title: 'Trade Instantly',
      description:
        'One-click links to mint positions directly on DeepBook Predict. No friction, just action.',
    },
  ]

  return (
    <section id="how-it-works" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className={`text-4xl font-bold mb-4 ${isDark ? 'text-gradient-white' : 'text-gradient-light'}`}>
            How DeepWatch Works
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            <span className="text-accent-primary font-semibold">DeepBook Predict</span> provides powerful market infrastructure, but traders often need additional context before taking a position.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((item, index) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.2 }}
              className={`relative rounded-2xl p-8 ${isDark ? 'border border-white/10' : 'border border-black/5 shadow-lg'}`}
              style={{
                background: isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                backdropFilter: 'blur(20px)',
              }}
            >
              <div className="absolute -top-4 -left-4 w-12 h-12 rounded-xl bg-accent-primary flex items-center justify-center font-bold text-black text-lg">
                {item.step}
              </div>
              <h3 className="text-xl font-bold text-white mt-4 mb-3">{item.title}</h3>
              <p className="text-gray-400">{item.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}