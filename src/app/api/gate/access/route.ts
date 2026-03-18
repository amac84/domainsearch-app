import { NextResponse } from "next/server";

import {
  getEmailGateCookieName,
  isEmailAllowed,
  isEmailGateEnabled,
  isValidEmailFormat,
  normalizeGateEmail,
} from "@/lib/email-gate";

interface GateAccessBody {
  email?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isEmailGateEnabled()) {
    return NextResponse.json(
      { error: "Email gate is not configured. Set EMAIL_GATE_ALLOWED in your environment." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as GateAccessBody;
  const email = normalizeGateEmail(body.email ?? "");

  if (!isValidEmailFormat(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (!isEmailAllowed(email)) {
    return NextResponse.json(
      { error: "This email is not on the allowlist." },
      { status: 403 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(getEmailGateCookieName(), email, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
