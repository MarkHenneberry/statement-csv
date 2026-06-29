import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Keeps the Supabase auth session fresh. No route gating/redirects here — it is a
// no-op when Supabase is not configured.
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on app routes; skip Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
