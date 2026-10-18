import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { getCurrentProfile } from "@/lib/auth";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { SiteAccountMenu } from "@/components/mobile-site-menu";
import { AsyncSiteNavigation } from "@/components/async-site-navigation";
import type { SiteNavigationData } from "@/lib/page-navigation";
import { getProfileAvatarUrl, getProfileDisplayName } from "@/lib/qq-profile-display";
import logo from "@/img/网站logo.png";

async function SiteAccount() {
  const profile = await getCurrentProfile();
  const displayName = getProfileDisplayName(profile, "已登录用户");
  const avatarUrl = getProfileAvatarUrl(profile);
  let hasRejectedNominations = false;

  if (profile) {
    const dataClient = await createServerDataClient();
    const { data } = await dataClient
      .from("nominations")
      .select("id")
      .eq("submitter_id", profile.id)
      .eq("status", "rejected")
      .limit(1);
    hasRejectedNominations = Boolean(data?.length);
  }

  return <SiteAccountMenu profile={profile ? {
    role: profile.role,
    displayName,
    avatarUrl,
    hasRejectedNominations,
  } : null} />;
}

export function SiteHeader({ navigation }: { navigation: Promise<SiteNavigationData> }) {
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
        <Suspense fallback={null}>
          <AsyncSiteNavigation navigation={navigation} />
        </Suspense>
        <Suspense fallback={null}>
          <SiteAccount />
        </Suspense>
      </div>
    </header>
  );
}
