import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function createServerDataClient() {
  return createServiceClient() ?? (await createClient());
}
