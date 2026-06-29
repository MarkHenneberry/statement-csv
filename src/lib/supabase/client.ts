"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config";

// Browser Supabase client for client components. Construct it inside event
// handlers / effects (never at module top-level or during render) so a build/SSR
// pass without env vars never instantiates it. Callers should guard with
// isSupabaseConfigured() before use.
export function createClient() {
  return createBrowserClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!);
}
