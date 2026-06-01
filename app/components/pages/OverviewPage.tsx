'use client';

import { Shield } from 'lucide-react';
import StatCard from '../common/StatCard';
import WelcomeCard from '../common/WelcomeCard';
import PageWrapper from '../common/PageWrapper';
import type { PageId } from '../../types/navigation';

interface OverviewPageProps {
  onNavigate: (pageId: PageId) => void;
}

export default function OverviewPage({ onNavigate }: OverviewPageProps) {
  return (
    <PageWrapper title="Overview">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <WelcomeCard onNavigate={onNavigate} />
        <StatCard
          title="Powered by"
          value="AI Models"
          subtitle="Advanced prediction engine"
          icon={Shield}
          accentColor="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Placeholder Cards */}
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
          <h3 className="text-lg font-bold mb-4 text-white">Prediction Stats</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Total Predictions</span>
              <span className="text-white font-semibold">--</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Accuracy Rate</span>
              <span className="text-white font-semibold">--</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Active Models</span>
              <span className="text-white font-semibold">--</span>
            </div>
          </div>
        </div>

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
          <h3 className="text-lg font-bold mb-4 text-white">Recent Activity</h3>
          <p className="text-gray-400 text-sm">No recent activity yet. Start a chat to begin making predictions.</p>
        </div>
      </div>
    </PageWrapper>
  );
}