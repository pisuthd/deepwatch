'use client';

import LandingHeader from './components/LandingHeader';
import LandingBackground from './components/LandingBackground';
import HeroSection from './components/HeroSection';
import HowItWorksSection from './components/HowItWorksSection';
import FeaturesSection from './components/FeaturesSection';
import PoweredBySection from './components/PoweredBySection';
import CTASection from './components/CTASection';
import LandingFooter from './components/LandingFooter';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <LandingHeader />
      <HeroSection />
      <LandingBackground />
      <HowItWorksSection />
      <FeaturesSection />
      <PoweredBySection />
      <CTASection />
      <LandingFooter />
    </div>
  );
}