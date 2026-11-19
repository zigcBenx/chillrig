const ADJECTIVES = [
  "bright",
  "quiet",
  "soft",
  "calm",
  "clear",
  "gentle",
  "misty",
  "lunar",
  "amber",
  "silver",
  "velvet",
  "crisp",
  "still",
  "sunny",
  "cozy",
  "fresh",
  "pale",
  "warm",
  "bold",
  "kind",
];

const NOUNS = [
  "otter",
  "cedar",
  "pebble",
  "harbor",
  "maple",
  "willow",
  "comet",
  "brook",
  "finch",
  "quartz",
  "meadow",
  "orbit",
  "pixel",
  "nimbus",
  "lotus",
  "spruce",
  "dune",
  "ripple",
  "grove",
  "lantern",
];

const RESERVED = new Set(["www", "app", "api", "admin", "mail", "ftp", "status", "box", "terminal"]);

export function candidateSlug(random = Math.random) {
  const adjective = ADJECTIVES[Math.floor(random() * ADJECTIVES.length)] ?? "calm";
  const noun = NOUNS[Math.floor(random() * NOUNS.length)] ?? "otter";
  return `${adjective}-${noun}`;
}

export function withSuffix(slug: string, random = Math.random) {
  const suffix = Math.floor(random() * 1296)
    .toString(36)
    .padStart(2, "0");
  return `${slug}-${suffix}`;
}

export function isSafeSlug(slug: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 40 && !RESERVED.has(slug);
}
