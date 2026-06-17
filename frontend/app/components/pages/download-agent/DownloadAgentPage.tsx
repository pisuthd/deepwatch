'use client';

import { Bot, Check } from 'lucide-react';
import PageWrapper from '../../common/PageWrapper';

const textPrimary = '#ffffff';
const textSecondary = '#9ca3af';

export default function DownloadAgentPage() {
  return (
    <PageWrapper title="Download Agent">
      <div className="max-w-2xl mx-auto">
        {/* Hero section */}
        <div className="text-center mb-10">
          <div className="w-20 h-20 rounded-2xl bg-accent-primary/10 flex items-center justify-center mx-auto mb-6">
            <Bot size={40} className="text-accent-primary" />
          </div> 
          <p className="text-lg" style={{ color: textSecondary }}>
            A trading agent that runs entirely on your machine.
          </p>
        </div>

        {/* Features single card */}
        <div
          className="rounded-2xl p-6 border border-white/10 mb-10"
          style={{ background: 'rgba(26, 29, 46, 0.4)' }}
        >
          <div className="flex items-center justify-center gap-8">
            <FeatureItem text="Fully Private" />
            <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <FeatureItem text="Fine-tuned AI" />
            <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <FeatureItem text="Completely Free" />
          </div>
        </div>

        {/* Hackathon teaser */}
        <div
          className="text-center rounded-2xl p-8 border border-white/10"
          style={{ background: 'rgba(26, 29, 46, 0.6)', backdropFilter: 'blur(20px)' }}
        >
          <p className="text-lg font-semibold mb-2" style={{ color: textPrimary }}>
            Coming to Sui Overflow Hackathon 2026
          </p>
          <p className="text-sm" style={{ color: textSecondary }}>
            Stay tuned for the official release.
          </p>
        </div>
      </div>
    </PageWrapper>
  );
}

function FeatureItem({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2">
      <Check size={16} className="text-accent-primary" />
      <span className="text-sm font-medium" style={{ color: textPrimary }}>
        {text}
      </span>
    </div>
  );
}