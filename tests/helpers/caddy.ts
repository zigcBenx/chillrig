import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const VERSION = "2.10.2";

export async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Caddy from PATH, or the release the boxes run, downloaded once and kept in /tmp. */
export async function caddyBinary() {
  const fromPath = spawnSync("bash", ["-lc", "command -v caddy"], { encoding: "utf8" });
  if (fromPath.status === 0 && fromPath.stdout.trim()) return fromPath.stdout.trim();
  const cached = path.join(tmpdir(), `chillrig-caddy-${VERSION}`);
  try {
    await readFile(cached);
    return cached;
  } catch {
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    const url = `https://github.com/caddyserver/caddy/releases/download/v${VERSION}/caddy_${VERSION}_linux_${arch}.tar.gz`;
    const dir = await mkdtemp(path.join(tmpdir(), "caddy-"));
    const archive = path.join(dir, "caddy.tgz");
    const download = spawnSync("curl", ["-fsSL", "-o", archive, url], { encoding: "utf8" });
    assert.equal(download.status, 0, download.stderr);
    const extracted = spawnSync("tar", ["-xzf", archive, "-C", dir, "caddy"]);
    assert.equal(extracted.status, 0);
    await chmod(path.join(dir, "caddy"), 0o755);
    await copyFile(path.join(dir, "caddy"), cached);
    await chmod(cached, 0o755);
    return cached;
  }
}

export async function waitForStatus(url: string, ok: (status: number) => boolean, init?: RequestInit) {
  const started = Date.now();
  let last = 0;
  while (Date.now() - started < 8000) {
    try {
      last = (await fetch(url, { redirect: "manual", ...init })).status;
      if (ok(last)) return;
    } catch {
      last = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${url}, last status ${last}`);
}
