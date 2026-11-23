/** Public Hetzner list prices, EUR excl. VAT, 2026-11-20. CX33 is the plan (~€8.49–€8.99). */

export const PLAN_MONTHLY_EUR = 8.49;

export type ServerTypeSpec = {
  name: string;
  vcpu: number;
  memoryGb: number;
  diskGb: number;
  monthlyEur: number;
  arch: "x86" | "arm";
};

export const SERVER_CATALOG: ServerTypeSpec[] = [
  { name: "cx33", vcpu: 4, memoryGb: 8, diskGb: 80, monthlyEur: 8.99, arch: "x86" },
  { name: "cax21", vcpu: 4, memoryGb: 8, diskGb: 80, monthlyEur: 10.99, arch: "arm" },
  { name: "cpx32", vcpu: 4, memoryGb: 8, diskGb: 160, monthlyEur: 30.49, arch: "x86" },
  { name: "cx23", vcpu: 2, memoryGb: 4, diskGb: 40, monthlyEur: 5.99, arch: "x86" },
  { name: "cax11", vcpu: 2, memoryGb: 4, diskGb: 40, monthlyEur: 5.99, arch: "arm" },
];

/** Last resort cax11: same size as cx23 on ARM, often still in stock when the CX line sells out. */
export const DEFAULT_TYPE_CHAIN = ["cx33", "cax21", "cx23", "cax11"];
export const DEFAULT_LOCATIONS = ["fsn1", "nbg1", "hel1"];
export const DEFAULT_MAX_MONTHLY_EUR = 12;
/** Hetzner primary IPv4, billed per server on top of the server price. */
export const IPV4_MONTHLY_EUR = 0.5;
/** Hetzner backups cost 20% of the server price. */
export const BACKUP_SHARE = 0.2;

/** What one box really costs per month: server, its IPv4 and (if on) backups. */
export function effectiveMonthlyEur(spec: Pick<ServerTypeSpec, "monthlyEur">, backups: boolean) {
  return spec.monthlyEur * (backups ? 1 + BACKUP_SHARE : 1) + IPV4_MONTHLY_EUR;
}

export type Placement = {
  serverType: string;
  location: string;
  spec: ServerTypeSpec | null;
};

export function maxMonthlyEur(value?: string) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_MAX_MONTHLY_EUR;
}

export function placementPlan(options?: {
  types?: string;
  singleType?: string;
  locations?: string;
  preferredLocation?: string;
  maxMonthlyEur?: number;
  backups?: boolean;
}): Placement[] {
  const cap = options?.maxMonthlyEur ?? DEFAULT_MAX_MONTHLY_EUR;
  const backups = options?.backups ?? false;
  const types = typeChain(options?.types, options?.singleType);
  const locations = locationChain(options?.preferredLocation, options?.locations);
  const plan: Placement[] = [];
  for (const serverType of types) {
    const spec = SERVER_CATALOG.find((item) => item.name === serverType) ?? null;
    // The cap is on the whole monthly bill for the box, not just the server price.
    if (!spec || effectiveMonthlyEur(spec, backups) > cap) continue;
    for (const location of locations) {
      plan.push({ serverType, location, spec });
    }
  }
  return plan;
}

export function isPricierThanPlan(monthlyEur: number) {
  return monthlyEur > PLAN_MONTHLY_EUR * 1.15;
}

export function fallbackNotice(placement: Placement, primary: Pick<Placement, "serverType" | "location">) {
  if (placement.serverType === primary.serverType && placement.location === primary.location) return null;
  const price = placement.spec ? `€${placement.spec.monthlyEur.toFixed(2)}/mo` : "unlisted price";
  const where = `${placement.serverType} in ${placement.location} (${price})`;
  if (placement.spec && isPricierThanPlan(placement.spec.monthlyEur)) {
    return `Hetzner fallback is pricier than the €${PLAN_MONTHLY_EUR.toFixed(2)} plan: ${where}`;
  }
  return `Hetzner fallback: ${where}`;
}

function typeChain(types: string | undefined, singleType: string | undefined) {
  const parsed = parseList(types);
  if (parsed.length > 0) return parsed;
  const chain = [...DEFAULT_TYPE_CHAIN];
  const preferred = singleType?.trim().toLowerCase();
  if (!preferred) return chain;
  return [preferred, ...chain.filter((name) => name !== preferred)];
}

function locationChain(preferredLocation: string | undefined, locations: string | undefined) {
  const parsed = parseList(locations);
  const base = parsed.length > 0 ? parsed : [...DEFAULT_LOCATIONS];
  const preferred = preferredLocation?.trim().toLowerCase() || base[0] || "fsn1";
  return [preferred, ...base.filter((name) => name !== preferred)];
}

function parseList(value: string | undefined) {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Drop placements Hetzner currently reports as out of stock. Hetzner can accept a create
 * for a sold-out type and then delete the server a minute later, so trying those first
 * leads to "the machine is gone". With no stock data, keep the plan as is.
 */
export function inStock(plan: Placement[], stock: Map<string, Set<string>> | null): Placement[] {
  if (!stock) return plan;
  return plan.filter((item) => stock.get(item.serverType)?.has(item.location) ?? false);
}
