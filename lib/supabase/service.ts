import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function createRequiredServiceClient() {
  const supabase = createServiceClient();

  if (!supabase) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required on the server.");
  }

  return supabase;
}
