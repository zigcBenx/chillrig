import { readFileSync } from "node:fs";
import path from "node:path";
import { shellQuote } from "./shell";

export function renderUserData(env: Record<string, string>, script = readInstallScript()) {
  const lines = ["#!/bin/bash", "set -euo pipefail"];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z0-9_]+$/.test(key)) throw new Error("Invalid cloud-init variable");
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  const body = script.replace(/^#!.*\n/, "").replace(/^set -euo pipefail\n/, "");
  lines.push(body.trimEnd());
  const userData = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(userData) > 32_000) {
    throw new Error("cloud-init user_data exceeds the Hetzner 32KB limit");
  }
  return userData;
}

export function readInstallScript() {
  return readFileSync(path.join(process.cwd(), "install.sh"), "utf8");
}
