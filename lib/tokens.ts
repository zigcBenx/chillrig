import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type SignedPayload = {
  purpose: string;
  exp: number;
};

export function signPayload(payload: SignedPayload & Record<string, unknown>, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readPayload<T extends SignedPayload>(token: string, secret: string): T | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }
  try {
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (!json || typeof json.exp !== "number" || json.exp < Date.now() / 1000) return null;
    if (typeof json.purpose !== "string") return null;
    return json;
  } catch {
    return null;
  }
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
