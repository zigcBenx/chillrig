import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export const metadata: Metadata = { title: "Get started" };

export default function StartPage() {
  return <OnboardingWizard />;
}
