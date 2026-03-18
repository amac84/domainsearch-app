import { NextRequest, NextResponse } from "next/server";

import {
  getEmailGateCookieName,
  isEmailAllowed,
  isEmailGateEnabled,
} from "@/lib/email-gate";

function isPublicPath(pathname: string): boolean {
  if (pathname === "/gate") return true;
  if (pathname === "/api/gate/access") return true;
  return false;
}

export function middleware(request: NextRequest): NextResponse {
  if (!isEmailGateEnabled()) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const pass = request.cookies.get(getEmailGateCookieName())?.value ?? "";
  if (isEmailAllowed(pass)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Email gate access required." }, { status: 401 });
  }

  const nextUrl = pathname + search;
  const gateUrl = new URL("/gate", request.url);
  gateUrl.searchParams.set("next", nextUrl);
  return NextResponse.redirect(gateUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)",
  ],
};
