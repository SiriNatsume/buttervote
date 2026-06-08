import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

export function getPublicImageUrl(imagePath?: string | null): string | null {
  if (!imagePath) {
    return null;
  }

  const { data } = supabase.storage
    .from("vote-images")
    .getPublicUrl(imagePath);

  return data.publicUrl;
}
