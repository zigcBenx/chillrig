export type GitHubRepo = {
  url: string;
  owner: string;
  repo: string;
};

const RESERVED = new Set([".", ".."]);

export function parseGitHubRepo(input: string): GitHubRepo | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 200 || /\s/.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  const owner = match[1] ?? "";
  const repo = match[2] ?? "";
  if (!owner || !repo || RESERVED.has(owner) || RESERVED.has(repo)) return null;
  if (owner.startsWith(".") || repo.startsWith(".")) return null;
  return {
    url: `https://github.com/${owner}/${repo}.git`,
    owner,
    repo,
  };
}
