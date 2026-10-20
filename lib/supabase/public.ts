import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import { supabaseFetch } from "@/lib/supabase/fetch";

// No cookies or service role: this client can only load anonymous public data.
export function createPublicClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: supabaseFetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}
