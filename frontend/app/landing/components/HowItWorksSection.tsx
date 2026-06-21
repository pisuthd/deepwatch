'use client';

import { motion } from 'framer-motion';

export default function HowItWorksSection() {

  const steps = [
    {
      step: '01',
      title: 'Generate Signals',
      description:
        'Predict, Polymarket, Kalshi in one terminal. AI generates directional signals and scores encrypted and stored on Walrus with Seal.',
    },
    {
      step: '02',
      title: 'Trade or Auto-Execute',
      description:
        'Trade UP / DOWN / RANGE positions on DeepBook Predict or let Auto Trade allocate capital to high-conviction AI signals.',
    },
    {
      step: '03',
      title: 'Stake for Access & Yield',
      description:
        'Deposit into the Predict Vault to mint PLP, then stake PLP for a Subscription NFT that unlocks encrypted AI insights and accrues yield.',
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
            Three steps from market signals to{' '}
            <span className="text-accent-primary font-semibold">AI-driven execution and stake-based access to encrypted insights</span>.
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
