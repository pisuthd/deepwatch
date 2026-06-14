'use client';

import Navbar from '@/components/shared/Navbar'; 
import Footer from '@/components/shared/Footer';
import HeroSection from '@/components/landing/HeroSection';
import WhatIsDeepBookPredictSection from '@/components/landing/WhatIsDeepBookPredictSection';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
import FeaturesSection from '@/components/landing/FeaturesSection';
import CTASection from '@/components/landing/CTASection';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <Navbar />
      <HeroSection />
      <WhatIsDeepBookPredictSection />
      <HowItWorksSection />
      <FeaturesSection />
      <CTASection />
      <Footer />
    </div>
  );
}
