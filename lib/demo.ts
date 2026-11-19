import type { Profile, Provider } from "@/lib/types";

const PEOPLE: Record<Provider, { id: string; email: string; name: string }> = {
  google: { id: "usr_demo_google", email: "avery.chen@gmail.com", name: "Avery Chen" },
  github: { id: "usr_demo_github", email: "riley@users.noreply.github.com", name: "Riley Okonkwo" },
};

export function demoProfile(provider: Provider): Profile {
  const person = PEOPLE[provider];
  return {
    ...person,
    provider,
    avatarUrl: null,
    stripeCustomerId: null,
    createdAt: new Date().toISOString(),
  };
}
