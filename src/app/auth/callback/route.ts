import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const nextPath = requestUrl.searchParams.get("next");
  const redirectPath =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  } else if (tokenHash && otpType) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType,
    });
  }

  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}
