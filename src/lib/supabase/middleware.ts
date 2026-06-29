import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, isSupabaseConfigured } from "./config";

/**
 * Refresh the Supabase auth session cookie on each request (current SSR pattern).
 * This does NOT gate or redirect any route — it only keeps the session fresh.
 * When Supabase is not configured it is a clean no-op, so the app builds and
 * serves normally without a configured project.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  if (!isSupabaseConfigured()) return supabaseResponse;

  const supabase = createServerClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: getUser() validates the token with the Supabase Auth server and
  // refreshes the session if needed. Do not add logic between client creation and
  // this call (per Supabase SSR guidance).
  await supabase.auth.getUser();

  return supabaseResponse;
}
