import Link from "next/link";
import { Suspense } from "react";
import { ContestCard } from "@/components/contest-card";
import {
  ContestGroupCard,
  type ContestGroupCardGroup,
} from "@/components/contest-group-card";
import { HomepageHeroPanel } from "@/components/homepage-hero-panel";
import { HomepageSidebar, HomepageSidebarSkeleton } from "@/components/homepage-sidebar";
import { MascotEmptyState, MascotFigure } from "@/components/mascot";
import { SiteFooter } from "@/components/site-footer";
import { TournamentBracket, TournamentBracketSkeleton } from "@/components/tournament-bracket";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { getPublicSiteSettings } from "@/lib/site-settings";
import { getTournamentBracket } from "@/lib/tournament-bracket";
import type { TournamentBracketData } from "@/lib/tournament-bracket";
import type { HomepageBracketValue, HomepageHeroValue } from "@/lib/types";
import type { HomepageVotingGroup } from "@/lib/homepage-sidebar";

type Hero = {
  title: string;
  description: string;
  imagePath?: string | null;
  href: string;
};

async function FeaturedTournamentBracket({
  data,
}: {
  data: Promise<TournamentBracketData | null>;
}) {
  const bracket = await data;
  return bracket && bracket.rounds.length > 0 ? (
    <div id="featured-tournament-bracket" className="mt-8 min-w-0 scroll-mt-24 lg:order-1 lg:mb-10 lg:mt-0">
      <TournamentBracket bracket={bracket} />
    </div>
  ) : null;
}

export default async function HomePage() {
  await applyScheduledTransitions({ revalidate: false });
  const supabase = await createClient();
  const [{ data: contests, error: contestsError }, settings] =
    await Promise.all([
      supabase
        .from("contests")
        .select("id,title,description,status,vote_type,image_path,group_id,show_candidate_image,love_vote_enabled,max_nominations_per_user,live_results_enabled,voting_starts_at,voting_ends_at,updated_at")
        .is("archived_at", null)
        .neq("status", "draft")
        .order("created_at", { ascending: false }),
      getPublicSiteSettings(),
    ]);
  if (contestsError) {
    throw new Error(`Failed to load homepage activities: ${contestsError.message}`);
  }
  const heroValue = (settings.get("homepage_hero") ?? null) as HomepageHeroValue | null;
  const bracketValue = (settings.get("homepage_bracket") ?? null) as HomepageBracketValue | null;
  const bracketTournamentId = settings.has("homepage_bracket")
    ? bracketValue?.tournamentId ?? null
    : heroValue?.featuredType === "tournament"
      ? heroValue.featuredId ?? null
      : null;
  // Start the heavy diagram independently; the hero and activity links can
  // stream as soon as their own data is ready.
  const featuredBracket = bracketTournamentId
    ? getTournamentBracket(supabase, bracketTournamentId)
    : Promise.resolve(null);
  const publicContests = contests ?? [];
  const contestGroupIds = Array.from(
    new Set(
      publicContests
        .map((contest) => contest.group_id)
        .filter((groupId): groupId is string => Boolean(groupId)),
    ),
  );
  const { data: contestGroups, error: contestGroupsError } = contestGroupIds.length
    ? await supabase
        .from("contest_groups")
        .select("id,name,description,cover_image_path,access_mode,love_vote_quota,love_vote_weight")
        .in("id", contestGroupIds)
    : { data: [] as Array<ContestGroupCardGroup & HomepageVotingGroup>, error: null };
  if (contestGroupsError) {
    throw new Error(`Failed to load homepage groups: ${contestGroupsError.message}`);
  }
  const contestGroupById = new Map(
    (contestGroups ?? []).map((group) => [group.id, group]),
  );
  const contestCountByGroup = new Map<string, number>();

  for (const contest of publicContests) {
    if (contest.group_id) {
      contestCountByGroup.set(
        contest.group_id,
        (contestCountByGroup.get(contest.group_id) ?? 0) + 1,
      );
    }
  }

  const listedContestGroupIds = new Set<string>();
  const publicEntries: Array<
    | { type: "contest"; contest: (typeof publicContests)[number] }
    | { type: "group"; group: ContestGroupCardGroup; contestCount: number }
  > = [];

  for (const contest of publicContests) {
    if (!contest.group_id) {
      publicEntries.push({ type: "contest", contest });
      continue;
    }

    const group = contestGroupById.get(contest.group_id);
    if (!group) {
      publicEntries.push({ type: "contest", contest });
      continue;
    }

    if (!listedContestGroupIds.has(group.id)) {
      listedContestGroupIds.add(group.id);
      publicEntries.push({
        type: "group",
        group,
        contestCount: contestCountByGroup.get(group.id) ?? 1,
      });
    }
  }
  let hero: Hero | null = null;

  if (heroValue?.featuredType === "group" && heroValue.featuredId) {
    const { data: group } = contestGroupById.has(heroValue.featuredId)
      ? { data: contestGroupById.get(heroValue.featuredId) }
      : await supabase
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
      };
    }
  }

  if (heroValue?.featuredType === "contest" && heroValue.featuredId) {
    const existingContest = publicContests.find((contest) => contest.id === heroValue.featuredId);
    const { data: contest } = existingContest
      ? { data: existingContest }
      : await supabase
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
      };
    }
  }

  if (heroValue?.featuredType === "tournament" && heroValue.featuredId) {
    const dataClient = await createServerDataClient();
    const [{ data: tournament }, { data: visibleMatches }] = await Promise.all([
      dataClient.from("tournaments").select("id,name")
        .eq("id", heroValue.featuredId).neq("status", "archived").maybeSingle(),
      publicContests.length > 0 && bracketTournamentId === heroValue.featuredId
        ? dataClient.from("tournament_matches").select("id,contests!inner(id)")
            .eq("tournament_id", heroValue.featuredId)
            .neq("contests.status", "draft")
            .is("contests.archived_at", null)
            .in("round", ["round_of_16", "quarterfinal", "semifinal", "final", "third_place"])
            .limit(1)
        : { data: [] },
    ]);

    if (tournament) {
      hero = {
        title: heroValue.title || tournament.name,
        description: heroValue.description || "查看正赛赛程、投票进度和公开结果。",
        imagePath: heroValue.imagePath,
        href:
          visibleMatches?.length
            ? "#featured-tournament-bracket"
            : "#public-contests",
      };
    }
  }

  const heroImageUrl = getPublicImageUrl(hero?.imagePath);
  const featuredContest = publicContests.find(
    (contest) => contest.status === "voting",
  ) ?? publicContests[0];
  const defaultHeroHref = featuredContest
    ? `/contests/${featuredContest.id}`
    : "#public-contests";
  const activeHero = hero ?? {
    title: "为喜欢的作品投出真爱票",
    description: "参与提名、投票和活动评选，发现大家共同喜欢的选择。",
    href: defaultHeroHref,
  };
  const showHeroDescription =
    heroValue?.showDescription !== false && Boolean(activeHero.description);

  return (
    <div className="homepage-layout mx-auto w-full max-w-[1536px] px-4 py-8 sm:px-6 sm:py-12 lg:pb-0 lg:pt-0">
      <section className="homepage-main min-w-0" aria-label="首页内容" tabIndex={0}>
        <section
          data-homepage-hero
          className="mb-8 overflow-hidden rounded-3xl border border-[#EED8AA]/80 bg-[#FFF8E8] shadow-sm lg:mb-10"
        >
          <div className="relative bg-[#FFF3D0]">
            <Link
              href={activeHero.href}
              aria-label={`打开${activeHero.title}`}
              className="group block focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-400/70 focus-visible:ring-inset"
            >
              <div className="flex min-h-[180px] items-center justify-center bg-[#FFF3D0] sm:min-h-[420px]">
              {heroImageUrl ? (
                <img
                  src={heroImageUrl}
                  fetchPriority="high"
                  decoding="async"
                  alt={`${activeHero.title} 首页图`}
                  data-homepage-hero-image="true"
                  className="block h-auto max-h-[min(72vh,620px)] max-w-full object-contain transition-transform duration-500 group-hover:scale-[1.005]"
                />
              ) : (
                <div className="butter-placeholder flex min-h-[260px] w-full items-end justify-center px-6 pt-8 sm:min-h-[420px] sm:px-10 sm:pt-10">
                  <MascotFigure
                    kind="homepageWelcome"
                    eager
                    className="h-[240px] w-auto sm:h-[390px]"
                  />
                </div>
              )}
              </div>
            </Link>

            <HomepageHeroPanel
              title={activeHero.title}
              description={activeHero.description}
              showDescription={showHeroDescription}
              imageUrl={heroImageUrl}
            />
          </div>
        </section>

        <aside className="homepage-aside mb-8 min-w-0 lg:mb-0" aria-label="投票与提名概览" tabIndex={0}>
          <Suspense fallback={<HomepageSidebarSkeleton />}>
            <HomepageSidebar publicClient={supabase} contests={publicContests} groups={contestGroups ?? []} />
          </Suspense>
        </aside>

        <div className="flex min-w-0 flex-col">
          <section id="public-contests" aria-labelledby="public-contests-title" className="scroll-mt-24 lg:order-2">
            <div className="mb-5 flex items-center justify-between">
              <h2 id="public-contests-title" className="text-xl font-semibold">公开活动</h2>
              <span className="text-sm text-muted-foreground">
                {publicEntries.length}
              </span>
            </div>

            {publicEntries.length > 0 ? (
              <div className="grid gap-5 md:grid-cols-2 min-[1440px]:grid-cols-3">
                {publicEntries.map((entry) =>
                  entry.type === "group" ? (
                    <ContestGroupCard
                      key={`group-${entry.group.id}`}
                      group={entry.group}
                      contestCount={entry.contestCount}
                    />
                  ) : (
                    <ContestCard
                      key={`contest-${entry.contest.id}`}
                      contest={entry.contest}
                    />
                  ),
                )}
              </div>
            ) : (
              <MascotEmptyState kind="emptyContests" title="暂无公开活动">
                活动发布后会显示在这里，请稍后再来查看。
              </MascotEmptyState>
            )}
          </section>
          {bracketTournamentId ? (
            <Suspense fallback={
              <div id="featured-tournament-bracket" className="mt-8 min-w-0 scroll-mt-24 lg:order-1 lg:mb-10 lg:mt-0">
                <TournamentBracketSkeleton />
              </div>
            }>
              <FeaturedTournamentBracket data={featuredBracket} />
            </Suspense>
          ) : null}
          <div className="hidden lg:order-3 lg:block">
            <SiteFooter />
          </div>
        </div>
      </section>
    </div>
  );
}
