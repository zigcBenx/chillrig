import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : "error";
  console.error(message.slice(0, 300));
  return json({ error: "Something went wrong" }, 500);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "Forbidden");
  }
  if (!host || originHost !== host) throw new HttpError(403, "Forbidden");
}

export function route(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try {
      await connection();
      return await handler(request);
    } catch (error) {
      unstable_rethrow(error);
      return jsonError(error);
    }
  };
}

export function requestOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "127.0.0.1:43123";
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "Setup failed";
  return message.replace(/[A-Za-z0-9_-]{24,}/g, "…").slice(0, 180);
}
