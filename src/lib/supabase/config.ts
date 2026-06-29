// Supabase public config (safe for the browser). These are the PUBLISHABLE keys
// only — never the service-role/secret key, and never a database URL. NEXT_PUBLIC_*
// values are inlined at build time.
//
// `isSupabaseConfigured()` lets always-on paths (middleware, header) degrade to a
// signed-out / no-op state when Supabase env vars are absent, so the app still
// builds and serves without a configured Supabase project.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}
