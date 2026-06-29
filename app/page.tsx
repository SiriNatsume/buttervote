import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { ContestCard } from "@/components/contest-card";
import { TournamentBracket } from "@/components/tournament-bracket";
import { Button } from "@/components/ui/button";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { getTournamentBracket } from "@/lib/tournament-bracket";
import type { TournamentBracketData } from "@/lib/tournament-bracket";
import type { HomepageBracketValue, HomepageHeroValue } from "@/lib/types";
import logo from "@/img/网站logo.png";

type Hero = {
  title: string;
  description: string;
  imagePath?: string | null;
  href: string;
  cta: string;
};

export default async function HomePage() {
  await applyScheduledTransitions({ revalidate: false });
  const supabase = await createClient();
  const [{ data: contests }, { data: heroSetting }, { data: bracketSetting }] =
    await Promise.all([
      supabase
        .from("contests")
        .select("id,title,description,status,vote_type,image_path")
        .is("archived_at", null)
        .neq("status", "draft")
        .order("created_at", { ascending: false }),
      supabase
        .from("site_settings")
        .select("value")
        .eq("key", "homepage_hero")
        .maybeSingle(),
      supabase
        .from("site_settings")
        .select("value")
        .eq("key", "homepage_bracket")
        .maybeSingle(),
    ]);
  const heroValue = (heroSetting?.value ?? null) as HomepageHeroValue | null;
  const bracketValue = (bracketSetting?.value ?? null) as HomepageBracketValue | null;
  const bracketTournamentId =
    bracketSetting !== null
      ? bracketValue?.tournamentId ?? null
      : heroValue?.featuredType === "tournament"
        ? heroValue.featuredId ?? null
        : null;
  let hero: Hero | null = null;
  let featuredBracket: TournamentBracketData | null = null;
  let heroTournamentBracket: TournamentBracketData | null = null;

  if (heroValue?.featuredType === "group" && heroValue.featuredId) {
    const { data: group } = await supabase
      .from("contest_groups")
      .select("id,name,description,cover_image_path")
      .eq("id", heroValue.featuredId)
      .maybeSingle();

    if (group) {
      hero = {
        title: heroValue.title || group.name,
        description:
          heroValue.description || group.description || "参与联合投票。",
        imagePath: heroValue.imagePath || group.cover_image_path,
        href: `/groups/${group.id}`,
        cta: "活动详情",
      };
    }
  }

  if (heroValue?.featuredType === "contest" && heroValue.featuredId) {
    const { data: contest } = await supabase
      .from("contests")
      .select("id,title,description,image_path")
      .eq("id", heroValue.featuredId)
      .is("archived_at", null)
      .maybeSingle();

    if (contest) {
      hero = {
        title: heroValue.title || contest.title,
        description:
          heroValue.description || contest.description || "为你支持的选项投票。",
        imagePath: heroValue.imagePath || contest.image_path,
        href: `/contests/${contest.id}`,
        cta: "打开活动",
      };
    }
  }

  if (heroValue?.featuredType === "tournament" && heroValue.featuredId) {
    const bracket = await getTournamentBracket(supabase, heroValue.featuredId);
    heroTournamentBracket = bracket;

    if (bracket) {
      hero = {
        title: heroValue.title || bracket.tournament.name,
        description: heroValue.description || "查看正赛赛程、投票进度和公开结果。",
        imagePath: heroValue.imagePath,
        href:
          bracketTournamentId === heroValue.featuredId && bracket.rounds.length > 0
            ? "#featured-tournament-bracket"
            : "#public-contests",
        cta:
          bracketTournamentId === heroValue.featuredId && bracket.rounds.length > 0
            ? "查看对阵"
            : "查看活动",
      };
    }
  }

  if (bracketTournamentId) {
    const bracket =
      heroTournamentBracket && bracketTournamentId === heroValue?.featuredId
        ? heroTournamentBracket
        : await getTournamentBracket(supabase, bracketTournamentId);
    featuredBracket = bracket && bracket.rounds.length > 0 ? bracket : null;
  }

  const heroImageUrl = getPublicImageUrl(hero?.imagePath);
  const featuredContest = (contests ?? []).find(
    (contest) => contest.status === "voting",
  ) ?? (contests ?? [])[0];
  const defaultHeroHref = featuredContest
    ? `/contests/${featuredContest.id}`
    : "#public-contests";
  const activeHero = hero ?? {
    title: "为喜欢的作品投出真爱票",
    description: "参与提名、投票和活动评选，发现大家共同喜欢的选择。",
    href: defaultHeroHref,
    cta: "开始投票",
  };
  const showHeroDescription =
    heroValue?.showDescription !== false && Boolean(activeHero.description);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <section className="mb-10 overflow-hidden rounded-3xl border border-[#EED8AA]/80 bg-[#FFF8E8] shadow-sm">
        <div className="relative bg-[#FFF3D0]">
          <div className="flex min-h-[180px] items-center justify-center bg-[#FFF3D0] sm:min-h-[420px]">
            {heroImageUrl ? (
              <img
                src={heroImageUrl}
                alt={`${activeHero.title} 首页图`}
                className="block h-auto max-h-[min(72vh,620px)] max-w-full object-contain"
              />
            ) : (
              <div className="butter-placeholder flex min-h-[220px] w-full items-center justify-center p-8 sm:min-h-[420px]">
                <Image
                  src={logo}
                  alt="Butter Vote logo"
                  className="w-[min(72%,520px)] object-contain opacity-90"
                  priority
                />
              </div>
            )}
          </div>

          <div
            className={
              showHeroDescription
                ? "relative z-10 border-t border-[#EED8AA]/70 bg-[#FFF8E8]/97 p-3 sm:absolute sm:bottom-5 sm:left-5 sm:max-w-[420px] sm:rounded-2xl sm:border sm:bg-[#FFF8E8]/88 sm:p-4 sm:shadow-sm sm:backdrop-blur-md lg:bottom-8 lg:left-8 lg:max-w-[460px]"
                : "relative z-10 border-t border-[#EED8AA]/70 bg-[#FFF8E8]/97 p-3 sm:absolute sm:inset-x-5 sm:bottom-5 sm:rounded-2xl sm:border sm:bg-[#FFF8E8]/88 sm:px-4 sm:py-3 sm:shadow-sm sm:backdrop-blur-md lg:inset-x-8 lg:bottom-8"
            }
          >
            <div
              className={
                showHeroDescription
                  ? "flex flex-col gap-2.5"
                  : "flex items-center justify-between gap-3"
              }
            >
              <h1
                className={
                  showHeroDescription
                    ? "max-w-full break-words text-2xl font-bold tracking-normal text-[#5C321E] sm:text-3xl"
                    : "min-w-0 flex-1 truncate text-xl font-bold tracking-normal text-[#5C321E] sm:text-2xl"
                }
              >
                {activeHero.title}
              </h1>
              {showHeroDescription ? (
                <p className="line-clamp-2 max-w-2xl text-sm leading-6 text-[#6A4A2B]">
                  {activeHero.description}
                </p>
              ) : null}
              <Button asChild size="sm" className="w-fit">
                <Link href={activeHero.href}>
                  {activeHero.cta}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {featuredBracket ? (
        <div id="featured-tournament-bracket" className="mb-10 min-w-0 scroll-mt-24">
          <TournamentBracket bracket={featuredBracket} />
        </div>
      ) : null}

      <div id="public-contests" className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold">公开活动</h2>
        <span className="text-sm text-muted-foreground">
          {(contests ?? []).length}
        </span>
      </div>

      {contests && contests.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {contests.map((contest) => (
            <ContestCard key={contest.id} contest={contest} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-muted-foreground">
          暂无公开活动。活动发布后会显示在这里，请稍后再来查看。
        </div>
      )}
    </div>
  );
}
