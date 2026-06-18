'use client';

import Link from 'next/link';
import { ArrowLeftRight, ChevronRight, Globe, Layers, Shield, TrendingUp } from 'lucide-react';
import StatCard from '../common/StatCard';
import WelcomeCard from '../common/WelcomeCard';
import PageWrapper from '../common/PageWrapper';
import PredictManagerPanel from './overview/PredictManagerPanel';
import PositionsPanel from './overview/PositionsPanel';


 
const QUICK_ACTIONS = [
  {
    label: 'Spot',
    description: 'Swap on DeepBook V3 pools',
    href: '/app/spot',
    icon: ArrowLeftRight,
  },
  {
    label: 'Predict',
    description: 'Binary options on settlement markets',
    href: '/app/predict',
    icon: TrendingUp,
  },
  {
    label: 'Margin',
    description: 'Coming soon...',
    href: '/app/margin',
    icon: Layers,
  },
] as const;

export default function OverviewPage() {
  return (
    <PageWrapper title="Overview">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <WelcomeCard /> 
        <StatCard
          title="Live on"
          value="Sui"
          subtitle="Mainnet + Testnet"
          icon={Globe}
          accentColor="blue"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PredictManagerPanel />

        <div
          className="relative overflow-hidden rounded-2xl p-6 border border-white/10"
          style={{
            background: 'rgba(26, 29, 46, 0.6)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/5 to-transparent" />
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <h3 className="text-lg font-bold mb-4 text-white">Quick Actions</h3>
          <div className="space-y-2">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="flex items-center gap-3 p-3 rounded-xl border border-white/5 hover:border-accent-primary/30 hover:bg-white/[0.02] transition-colors group"
              >
                <div className="w-9 h-9 rounded-lg bg-accent-primary/10 flex items-center justify-center group-hover:bg-accent-primary/20 transition-colors">
                  <action.icon size={16} className="text-accent-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{action.label}</p>
                  <p className="text-xs text-gray-400">{action.description}</p>
                </div>
                <ChevronRight size={14} className="text-gray-500 group-hover:text-accent-primary transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <PositionsPanel />
      </div>
    </PageWrapper>
  );
}
