import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// These settings are publicly readable. Batch the shared layout/homepage
// reads, without retaining settings or user identity across requests.
export const getPublicSiteSettings = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("site_settings")
    .select("key,value")
    .in("key", ["site_navigation", "homepage_hero", "homepage_bracket"]);

  if (error) throw new Error(`Failed to load site settings: ${error.message}`);
  return new Map((data ?? []).map((setting) => [setting.key, setting.value]));
});
