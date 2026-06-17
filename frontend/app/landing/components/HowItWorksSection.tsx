'use client';

import { motion } from 'framer-motion';

export default function HowItWorksSection() {

  const steps = [
    {
      step: '01',
      title: 'Compare live odds across venues',
      description:
        'Polymarket, Kalshi, and DeepBook Predict polled every 90 seconds and rendered side by side. Spot the mispricings before the market does.',
    },
    {
      step: '02',
      title: '(Optional) Ask the AI for context',
      description:
        'Generate a structured summary from live odds and on-chain SVI surface data — kept on your device, never uploaded.',
    },
    {
      step: '03',
      title: 'Trade on DeepBook Predict',
      description:
        'Mint, range, or redeem binary positions against the DeepBook Predict oracle, all from the same terminal.',
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
          <h2 className="text-4xl font-bold mb-4 text-gradient-white">
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
              className="relative rounded-2xl p-8 border border-white/10"
              style={{
                background: 'rgba(26, 29, 46, 0.6)',
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
