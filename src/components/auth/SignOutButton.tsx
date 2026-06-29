"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function SignOutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!isSupabaseConfigured()) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    setBusy(false);
    router.push("/");
    router.refresh();
  }

  return (
    <button type="button" onClick={onClick} disabled={busy} className={className}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
