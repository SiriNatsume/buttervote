import "server-only";

import { cache } from "react";
import { revalidateTag, unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";

const PUBLIC_SETTINGS_TAG = "public-site-settings";

// Only this explicit allowlist is shared between visitors. Session, permission,
// activity state and voting data are never read inside the persistent cache.
const loadPublicSiteSettings = unstable_cache(async () => {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("site_settings")
    .select("key,value")
    .in("key", ["site_navigation", "homepage_hero", "homepage_bracket"]);

  if (error) throw new Error(`Failed to load site settings: ${error.message}`);
  return data ?? [];
}, ["public-site-settings-v1", process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""], {
  revalidate: 60,
  tags: [PUBLIC_SETTINGS_TAG],
});

export const getPublicSiteSettings = cache(async () =>
  new Map((await loadPublicSiteSettings()).map((setting) => [setting.key, setting.value])),
);

export function invalidatePublicSiteSettings() {
  revalidateTag(PUBLIC_SETTINGS_TAG);
}
