'use client';

import LandingHeader from './components/LandingHeader';
import LandingBackground from './components/LandingBackground';
import HeroSection from './components/HeroSection';
import WhatIsDeepBookPredictSection from './components/WhatIsDeepBookPredictSection';
import HowItWorksSection from './components/HowItWorksSection';
import CTASection from './components/CTASection';
import LandingFooter from './components/LandingFooter';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <LandingHeader />
      <HeroSection />
      <LandingBackground />
      <WhatIsDeepBookPredictSection />
      <HowItWorksSection />
      <CTASection />
      <LandingFooter />
    </div>
  );
}