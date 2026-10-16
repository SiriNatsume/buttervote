import Link from "next/link";
import Image from "next/image";
import { getCurrentProfile } from "@/lib/auth";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { SiteAccountMenu } from "@/components/mobile-site-menu";
import { SiteNavigation } from "@/components/site-navigation";
import type { SiteNavigationData } from "@/lib/page-navigation";
import logo from "@/img/网站logo.png";

export async function SiteHeader({ navigation }: { navigation: SiteNavigationData }) {
  const profile = await getCurrentProfile();
  const displayName =
    profile?.qq_nickname ||
    profile?.display_name ||
    profile?.email ||
    "已登录用户";
  const avatarUrl =
    typeof profile?.qq_avatar_url === "string" ? profile.qq_avatar_url : null;
  let hasRejectedNominations = false;

  if (profile) {
    const dataClient = await createServerDataClient();
    const { count } = await dataClient
      .from("nominations")
      .select("id", { count: "exact", head: true })
      .eq("submitter_id", profile.id)
      .eq("status", "rejected");
    hasRejectedNominations = (count ?? 0) > 0;
  }

  return (
    <header className="sticky top-0 z-40 h-[var(--site-header-height)] shrink-0 border-b border-[#E9E1D2] bg-[#FFFEFA]/95 backdrop-blur lg:bg-[#FFFEFA]/80 lg:backdrop-blur-[10px]">
      <div className="mx-auto flex h-full max-w-[1536px] items-center gap-4 px-4 sm:px-6 lg:gap-[58px]">
        <Link href="/" className="shrink-0" aria-label="Butter Vote 首页">
          <Image
            src={logo}
            alt="Butter Vote logo"
            className="h-auto w-[149px] lg:w-[184px]"
            priority
          />
        </Link>
        <SiteNavigation navigation={navigation} />
        <SiteAccountMenu
          profile={profile ? {
            role: profile.role,
            displayName,
            avatarUrl,
            hasRejectedNominations,
          } : null}
        />
      </div>
    </header>
  );
}
