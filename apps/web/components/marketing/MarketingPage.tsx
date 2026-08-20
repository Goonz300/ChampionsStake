import { Navbar } from "@/components/marketing/Navbar";
import { Hero } from "@/components/marketing/Hero";
import { ConceptSection } from "@/components/marketing/ConceptSection";
import { HowItWorksSection } from "@/components/marketing/HowItWorksSection";
import { PlatformExperienceSection } from "@/components/marketing/PlatformExperienceSection";
import { WhySection } from "@/components/marketing/WhySection";
import { PlatformStatusSection } from "@/components/marketing/PlatformStatusSection";
import { AboutSection } from "@/components/marketing/AboutSection";
import { FAQSection } from "@/components/marketing/FAQSection";
import { ContactSection } from "@/components/marketing/ContactSection";
import { Footer } from "@/components/marketing/Footer";

/**
 * The public marketing site shown at "/" to anyone who isn't signed in
 * (app/page.tsx redirects a signed-in session to "/dashboard" before this
 * ever renders). Replaces components/landing/LandingPage.tsx, which is
 * left in place but no longer imported anywhere -- see the build report for
 * why it wasn't deleted outright.
 */
export function MarketingPage() {
  return (
    <div className="bg-vv-black relative text-white">
      <a
        href="#main-content"
        className="mkt-focus-ring bg-vv-neon-green text-vv-black sr-only z-[100] rounded-md px-4 py-2 text-sm font-bold focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>

      <Navbar />

      <main id="main-content">
        <Hero />
        <ConceptSection />
        <HowItWorksSection />
        <PlatformExperienceSection />
        <WhySection />
        <PlatformStatusSection />
        <AboutSection />
        <FAQSection />
        <ContactSection />
      </main>

      <Footer />
    </div>
  );
}
