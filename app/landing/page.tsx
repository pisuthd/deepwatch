'use client';

import LandingHeader from './components/LandingHeader'; 
import HeroSection from './components/HeroSection';
import WhatIsDeepBookPredictSection from './components/WhatIsDeepBookPredictSection';
import HowItWorksSection from './components/HowItWorksSection';
import FeaturesSection from './components/FeaturesSection';
import CTASection from './components/CTASection';
import LandingFooter from './components/LandingFooter';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <LandingHeader />
      <HeroSection />
      <WhatIsDeepBookPredictSection />
      <HowItWorksSection />
      <FeaturesSection />
      <CTASection />
      <LandingFooter/>
    </div>
  );
}
