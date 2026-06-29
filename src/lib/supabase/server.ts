import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, isSupabaseConfigured } from "./config";

/**
 * Server Supabase client for server components, server actions, and route handlers.
 * Reads/writes the auth cookies via Next's cookie store. Constructed per request
 * (never at module load) so build never connects.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component (cookies are read-only there); the
          // middleware session refresh handles writing refreshed cookies.
        }
      },
    },
  });
}

/**
 * Validated current user from Supabase Auth (verifies the token with the auth
 * server — do NOT trust client-provided IDs). Returns null when not signed in or
 * when Supabase is not configured. Use this to gate protected pages/data.
 */
export async function getAuthenticatedUser(): Promise<{ id: string; email: string } | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !data.user.email) return null;
  return { id: data.user.id, email: data.user.email };
}
