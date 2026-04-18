import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

function firstNonEmpty(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const metadata = user.user_metadata ?? {};
  const preferredName = firstNonEmpty(
    metadata.full_name,
    metadata.name,
    metadata.preferred_name,
    metadata.given_name,
  );
  const firstName = preferredName ? preferredName.split(/\s+/)[0] ?? preferredName : null;

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email ?? null,
      firstName,
      fullName: preferredName,
    },
  });
}
