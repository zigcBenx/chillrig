import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

async function freePort() {
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

async function caddyBinary() {
  const fromPath = spawnSync("bash", ["-lc", "command -v caddy"], { encoding: "utf8" });
  if (fromPath.status === 0 && fromPath.stdout.trim()) return fromPath.stdout.trim();
  const cached = "/tmp/caddy";
  try {
    await readFile(cached);
    return cached;
  } catch {
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    const url = `https://github.com/caddyserver/caddy/releases/download/v2.10.2/caddy_2.10.2_linux_${arch}.tar.gz`;
    const dir = await mkdtemp(path.join(tmpdir(), "caddy-"));
    const archive = path.join(dir, "caddy.tgz");
    const download = spawnSync("curl", ["-fsSL", "-o", archive, url], { encoding: "utf8" });
    assert.equal(download.status, 0, download.stderr);
    const extracted = spawnSync("tar", ["-xzf", archive, "-C", dir, "caddy"]);
    assert.equal(extracted.status, 0);
    await chmod(path.join(dir, "caddy"), 0o755);
    return path.join(dir, "caddy");
  }
}

describe("self-host basic auth", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const caddy = await caddyBinary();
    const dir = await mkdtemp(path.join(tmpdir(), "chillrig-auth-"));
    const password = "correct-horse";
    await writeFile(path.join(dir, "password"), password);
    const hashed = spawnSync(caddy, ["hash-password", "--plaintext", password], { encoding: "utf8" });
    assert.equal(hashed.status, 0, hashed.stderr);
    assert.match(hashed.stdout, /^\$2[aby]\$/);
    const written = spawnSync(
      "python3",
      ["-c", "import os; from pathlib import Path; p=os.environ['AUTH_PATH']; u=os.environ['AUTH_USER']; h=os.environ['AUTH_HASH'].strip(); Path(p).write_text(f'basic_auth {{\\n\\t{u} {h}\\n}}\\n')"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          AUTH_PATH: path.join(dir, "auth.caddy"),
          AUTH_USER: "coder",
          AUTH_HASH: hashed.stdout.trim(),
        },
      },
    );
    assert.equal(written.status, 0, written.stderr);
    const authFile = await readFile(path.join(dir, "auth.caddy"), "utf8");
    assert.match(authFile, /\$2[aby]\$/);
    assert.doesNotMatch(authFile, /\$\$/);

    const port = await freePort();
    const config = path.join(dir, "Caddyfile");
    await writeFile(
      config,
      `{
	admin off
}
:${port} {
	handle /ttyd/* {
		import ${path.join(dir, "auth.caddy")}
		respond "ok" 200
	}
}
`,
    );
    const child = spawn(caddy, ["run", "--config", config], { stdio: "ignore" });
    try {
      await waitFor(`http://127.0.0.1:${port}/ttyd/`, 401);
      assert.equal(await status(port, password), 200);
      assert.equal(await status(port, "wrong-password"), 401);
      assert.equal(await status(port, null), 401);
    } finally {
      child.kill("SIGTERM");
    }
  });
});

async function status(port: number, password: string | null) {
  const headers = password ? { authorization: `Basic ${Buffer.from(`coder:${password}`).toString("base64")}` } : undefined;
  const response = await fetch(`http://127.0.0.1:${port}/ttyd/`, { headers });
  return response.status;
}

async function waitFor(url: string, expected: number) {
  const started = Date.now();
  let last = 0;
  while (Date.now() - started < 5000) {
    try {
      last = (await fetch(url)).status;
      if (last === expected) return;
    } catch {
      last = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${url}, last status ${last}`);
}
