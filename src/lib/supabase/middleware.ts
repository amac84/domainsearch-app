import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseConfig, hasSupabaseConfig } from "@/lib/supabase/config";

export interface MiddlewareSessionResult {
  response: NextResponse;
  user: User | null;
}

export async function updateSupabaseSession(
  request: NextRequest,
): Promise<MiddlewareSessionResult> {
  if (!hasSupabaseConfig()) {
    return {
      response: NextResponse.next({
        request,
      }),
      user: null,
    };
  }

  let response = NextResponse.next({
    request,
  });

  const { url, anonKey } = getSupabaseConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
