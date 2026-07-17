import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, FileText, ImageIcon, Send, Settings, Trophy } from "lucide-react";
import { GroupContestControl } from "@/components/group-contest-control";
import { GroupHomepageSection } from "@/components/group-homepage-section";
import { GroupRecentResults } from "@/components/group-recent-results";
import { GroupShareButton } from "@/components/group-share-button";
import { TournamentBracket } from "@/components/tournament-bracket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth";
import { canNominateByStatus } from "@/lib/contest-rules";
import { loadGroupHomepageContests } from "@/lib/group-homepage-data";
import {
  GROUP_HOMEPAGE_RECENT_RESULT_LIMIT,
  partitionGroupHomepageContests,
} from "@/lib/group-homepage";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { getTournamentBracket } from "@/lib/tournament-bracket";

type RelatedPage = { id: string; title: string; slug: string };

function RelatedPages({ pages }: { pages: RelatedPage[] }) {
  return (
    <div className="space-y-1">
      {pages.map((page) => (
        <Link
          key={page.id}
          href={`/pages/${page.slug}`}
          className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-[#5A3826] transition hover:bg-[#F4EAD7]"
        >
          <FileText className="size-4 shrink-0" />
          <span className="break-words border-b border-dashed border-current">{page.title}</span>
        </Link>
      ))}
    </div>
  );
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await applyScheduledTransitions({ revalidate: false });
  const supabase = await createClient();
  const [
    { data: group },
    { data: contests, error: contestsError },
    { data: settings },
    profile,
  ] = await Promise.all([
      supabase
        .from("contest_groups")
        .select(
          "id,name,description,cover_image_path,access_mode,love_vote_weight",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase.rpc("get_group_homepage_contests", {
        p_group_id: id,
        p_recent_limit: GROUP_HOMEPAGE_RECENT_RESULT_LIMIT,
      }),
      supabase
        .from("contest_group_homepage_settings")
        .select("show_bracket,featured_tournament_id")
        .eq("contest_group_id", id)
        .maybeSingle(),
      getCurrentProfile(),
    ]);

  if (!group) notFound();
  if (contestsError) {
    console.error(
      `[group-homepage] contest query failed: ${contestsError.message}`,
    );
    throw new Error("Group homepage contests are temporarily unavailable.");
  }
  const isAdmin = profile?.role === "admin";
  const publicHomepageContests = (contests ?? []).filter(
    (contest) => contest.status !== "admin_nominating",
  );
  const homepageContests = await loadGroupHomepageContests({
    publicClient: supabase,
    contests: publicHomepageContests,
    loveVoteWeight: Number(group.love_vote_weight),
  });
  const { ongoing, upcoming, recent } =
    partitionGroupHomepageContests(homepageContests);
  const referenceNow = Date.now();

  const { data: pageRelations } = await supabase
    .from("contest_group_pages")
    .select("page_id,sort_order")
    .eq("contest_group_id", id)
    .order("sort_order", { ascending: true });
  const pageIds = (pageRelations ?? []).map((relation) => relation.page_id);
  const { data: pageRows } =
    pageIds.length > 0
      ? await supabase
          .from("site_pages")
          .select("id,title,slug")
          .eq("visibility", "public")
          .in("id", pageIds)
      : { data: [] as RelatedPage[] };
  const pageById = new Map((pageRows ?? []).map((page) => [page.id, page]));
  const relatedPages = pageIds.flatMap((pageId) => {
    const page = pageById.get(pageId);
    return page ? [page] : [];
  });

  const showBracket = settings?.show_bracket === true;
  const bracket =
    showBracket && settings?.featured_tournament_id
      ? await getTournamentBracket(supabase, settings.featured_tournament_id)
      : null;

  const isRestricted = group.access_mode === "restricted";
  const canParticipate = isRestricted
    ? await canParticipateContestGroup({ contestGroupId: group.id, profile })
    : Boolean(profile);
  const hasVotingContest = ongoing.some((contest) => contest.status === "voting");
  let nominatableContests = (contests ?? []).filter((contest) =>
    canNominateByStatus(contest, profile),
  );
  if (profile && !isAdmin && nominatableContests.length > 0) {
    const limitedIds = nominatableContests
      .filter((contest) => contest.max_nominations_per_user !== null)
      .map((contest) => contest.id);
    if (limitedIds.length > 0) {
      const privilegedClient = await createServerDataClient();
      const { data: ownNominations } = await privilegedClient
        .from("nominations")
        .select("contest_id")
        .eq("submitter_id", profile.id)
        .neq("status", "rejected")
        .in("contest_id", limitedIds);
      const counts = new Map<string, number>();
      for (const nomination of ownNominations ?? []) {
        counts.set(
          nomination.contest_id,
          (counts.get(nomination.contest_id) ?? 0) + 1,
        );
      }
      nominatableContests = nominatableContests.filter(
        (contest) =>
          contest.max_nominations_per_user === null ||
          (counts.get(contest.id) ?? 0) < contest.max_nominations_per_user,
      );
    }
  }
  const hasNominationEntry =
    nominatableContests.length > 0 && (!isRestricted || canParticipate);
  const hasVotingEntry = hasVotingContest && (!isRestricted || canParticipate);
  const coverUrl = getPublicImageUrl(group.cover_image_path);

  const relatedPagesSection =
    relatedPages.length > 0 ? (
      <GroupHomepageSection title="关联页面">
        <RelatedPages pages={relatedPages} />
      </GroupHomepageSection>
    ) : null;

  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 py-8 sm:px-6 sm:py-12">
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] xl:gap-12">
        <aside className="space-y-7 lg:sticky lg:top-28 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-3">
          <section>
            <div className="aspect-video overflow-hidden rounded-xl border border-[#EED8AA]/70 bg-muted shadow-sm">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={`${group.name} 封面`}
                  className="size-full object-cover"
                />
              ) : (
                <div className="butter-placeholder flex size-full items-center justify-center">
                  <ImageIcon className="size-10" aria-hidden="true" />
                </div>
              )}
            </div>
            <h1 className="mt-5 break-words text-3xl font-semibold leading-tight sm:text-4xl">
              {group.name}
            </h1>
            <p className="mt-3 whitespace-pre-wrap leading-7 text-muted-foreground">
              {group.description || "暂无简介。"}
            </p>
            {isRestricted ? (
              <div className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
                <Badge variant="love">限定用户组</Badge>
                <p>
                  {!profile
                    ? "该活动组仅限指定用户组参与提名和投票，请先通过专属链接登录。"
                    : canParticipate
                      ? "你已拥有该活动组的参与权限。"
                      : "你暂时没有参与该活动组提名或投票的权限。"}
                </p>
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              {hasNominationEntry ? (
                <Button asChild variant="secondary">
                  <Link href={`/groups/${group.id}/nominate`}>
                    <Send className="size-4" />参与提名
                  </Link>
                </Button>
              ) : null}
              {hasVotingEntry ? (
                <Button asChild>
                  <Link href={`/groups/${group.id}/vote`}>
                    <BarChart3 className="size-4" />前往投票
                  </Link>
                </Button>
              ) : null}
              {recent.length > 0 ? (
                <Button asChild variant="outline">
                  <Link href={`/groups/${group.id}/results`}>
                    <Trophy className="size-4" />查看结果
                  </Link>
                </Button>
              ) : null}
              <GroupShareButton groupId={group.id} />
            </div>
          </section>

          {ongoing.length > 0 ? (
            <GroupHomepageSection title="投票进行中">
              <div className="space-y-2">
                {ongoing.map((contest) => (
                  <GroupContestControl
                    key={contest.id}
                    contest={contest}
                    referenceNow={referenceNow}
                  />
                ))}
              </div>
            </GroupHomepageSection>
          ) : null}

          {upcoming.length > 0 ? (
            <GroupHomepageSection title="即将开始">
              <div className="space-y-2">
                {upcoming.map((contest) => (
                  <GroupContestControl
                    key={contest.id}
                    contest={contest}
                    referenceNow={referenceNow}
                  />
                ))}
              </div>
            </GroupHomepageSection>
          ) : null}

          <div className="hidden lg:block">{relatedPagesSection}</div>
        </aside>

        <main className="min-w-0 space-y-8">
          {showBracket ? (
            <GroupHomepageSection title="对阵图">
              {bracket && bracket.rounds.length > 0 ? (
                <div className="group-homepage-bracket-fit">
                  <TournamentBracket bracket={bracket} />
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#DCC69F] px-5 py-12 text-center text-muted-foreground">
                  <p>对阵图尚未生成。</p>
                  {isAdmin ? (
                    <Button asChild variant="outline" size="sm" className="mt-4">
                      <Link href={`/admin/groups/${group.id}/edit`}>
                        <Settings className="size-4" />配置首页对阵图
                      </Link>
                    </Button>
                  ) : null}
                </div>
              )}
            </GroupHomepageSection>
          ) : null}

          {recent.length > 0 ? (
            <GroupRecentResults contests={recent} referenceNow={referenceNow} />
          ) : null}

          <div className="lg:hidden">{relatedPagesSection}</div>
        </main>
      </div>
    </div>
  );
}
