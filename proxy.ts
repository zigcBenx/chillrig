import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/setup", "/checkout", "/terminal", "/preview", "/connect", "/start"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (!needsAuth || hasAuthCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

function hasAuthCookie(request: NextRequest) {
  if (request.cookies.get("chillrig_session")?.value) return true;
  return request.cookies.getAll().some((cookie) => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name) && cookie.value);
}

export const config = {
  matcher: ["/dashboard/:path*", "/setup", "/checkout", "/terminal", "/preview", "/connect/:path*", "/start"],
};
