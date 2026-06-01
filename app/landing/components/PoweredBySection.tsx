'use client';

import { motion } from 'framer-motion';
import { useTheme } from '../../context/ThemeContext';

export default function PoweredBySection() {
  const { isDark } = useTheme();

  const providers = [
    { name: 'DeepBook Predict', description: 'Sui-native prediction markets' },
    { name: 'Tatum', description: 'RPC + Prediction Market Data API' },
    { name: 'Walrus', description: 'Decentralized storage layer' },
    { name: 'Sui', description: 'Mainnet blockchain' },
  ];

  return (
    <section id="powered-by" className="py-24 px-6">
      <div className="max-w-4xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <p className="text-gray-500 text-sm uppercase tracking-wider mb-8">Powered By</p>
          <div className="flex flex-wrap justify-center gap-8">
            {providers.map((provider) => (
              <div
                key={provider.name}
                className={`px-6 py-4 rounded-xl ${isDark ? 'border border-white/10' : 'border border-black/5 shadow-md'}`}
                style={{
                  background: isDark ? 'rgba(26, 29, 46, 0.6)' : 'rgba(255, 255, 255, 0.8)',
                  backdropFilter: 'blur(20px)',
                }}
              >
                <p className="font-semibold text-white">{provider.name}</p>
                <p className="text-sm text-gray-500">{provider.description}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}