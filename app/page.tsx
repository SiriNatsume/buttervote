import { ContestCard } from "@/components/contest-card";
import {
  ContestGroupCard,
  type ContestGroupCardGroup,
} from "@/components/contest-group-card";
import { HomepageHeroPanel } from "@/components/homepage-hero-panel";
import { MascotEmptyState, MascotFigure } from "@/components/mascot";
import { TournamentBracket } from "@/components/tournament-bracket";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { getTournamentBracket } from "@/lib/tournament-bracket";
import type { TournamentBracketData } from "@/lib/tournament-bracket";
import type { HomepageBracketValue, HomepageHeroValue } from "@/lib/types";

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
        .select("id,title,description,status,vote_type,image_path,group_id")
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
  const publicContests = contests ?? [];
  const contestGroupIds = Array.from(
    new Set(
      publicContests
        .map((contest) => contest.group_id)
        .filter((groupId): groupId is string => Boolean(groupId)),
    ),
  );
  const { data: contestGroups } = contestGroupIds.length
    ? await supabase
        .from("contest_groups")
        .select("id,name,description,cover_image_path")
        .in("id", contestGroupIds)
    : { data: [] as ContestGroupCardGroup[] };
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
                data-homepage-hero-image="true"
                className="block h-auto max-h-[min(72vh,620px)] max-w-full object-contain"
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

          <HomepageHeroPanel
            title={activeHero.title}
            description={activeHero.description}
            href={activeHero.href}
            cta={activeHero.cta}
            showDescription={showHeroDescription}
            imageUrl={heroImageUrl}
          />
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
          {publicEntries.length}
        </span>
      </div>

      {publicEntries.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}
