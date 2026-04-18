import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthenticatedRequest {
  userId: string;
}

export async function requireAuthenticatedUser(): Promise<
  AuthenticatedRequest | NextResponse
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  return { userId: user.id };
}
