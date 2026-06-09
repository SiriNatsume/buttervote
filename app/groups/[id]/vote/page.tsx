import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageIcon } from "lucide-react";
import { GroupAccessDeniedPanel } from "@/components/group-access-denied-panel";
import { GroupVoteForm } from "@/components/group-vote-form";
import { TournamentBracket } from "@/components/tournament-bracket";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { getTournamentBracketsForGroup } from "@/lib/tournament-bracket";

export default async function GroupVotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  await applyScheduledTransitions({ revalidate: false });
  const supabase = await createServerDataClient();
  const [{ data: group }, { data: contests }] = await Promise.all([
    supabase
      .from("contest_groups")
      .select("id,name,description,cover_image_path,love_vote_quota,love_vote_weight,access_mode")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("contests")
      .select(
        "id,title,status,vote_type,max_choices,require_exact_choices,show_candidate_image,show_candidate_description,show_nominator_info,love_vote_enabled,created_at",
      )
      .eq("group_id", id)
      .is("archived_at", null)
      .eq("status", "voting")
      .order("created_at", { ascending: true }),
  ]);

  if (!group) {
    notFound();
  }

  const canParticipate = await canParticipateContestGroup({
    contestGroupId: group.id,
    profile: user,
  });

  if (!canParticipate) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <GroupAccessDeniedPanel backHref={`/groups/${group.id}`} />
      </div>
    );
  }

  const contestIds = (contests ?? []).map((contest) => contest.id);
  const [{ data: candidates }, { data: existingVotes }, { count: usedLoveVotes }] =
    contestIds.length > 0
      ? await Promise.all([
          supabase
            .from("candidates")
            .select("id,contest_id,name,description,image_path,nominator_display_name,created_at")
            .in("contest_id", contestIds)
            .eq("is_active", true)
            .order("created_at", { ascending: true }),
          supabase
            .from("votes")
            .select("id,contest_id")
            .eq("voter_id", user.id)
            .in("contest_id", contestIds),
          supabase
            .from("love_vote_allocations")
            .select("id", { count: "exact", head: true })
            .eq("group_id", id)
            .eq("voter_id", user.id),
        ])
      : [{ data: [] }, { data: [] }, { count: 0 }];

  const candidatesByContest = new Map(
    contestIds.map((contestId) => [
      contestId,
      (candidates ?? []).filter((candidate) => candidate.contest_id === contestId),
    ]),
  );
  const voteByContest = new Map(
    (existingVotes ?? []).map((vote) => [vote.contest_id, vote.id]),
  );
  const contestsWithCandidates = (contests ?? []).map((contest) => ({
    ...contest,
    candidates: candidatesByContest.get(contest.id) ?? [],
    existingVoteId: voteByContest.get(contest.id) ?? null,
  }));
  const tournamentBrackets = await getTournamentBracketsForGroup(supabase, id);
  const contestHrefById = Object.fromEntries(
    contestIds.map((contestId) => [
      contestId,
      `#group-vote-contest-${contestId}`,
    ]),
  );
  const coverUrl = getPublicImageUrl(group.cover_image_path);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="mb-8 space-y-5">
        <div className="aspect-video overflow-hidden rounded-3xl border border-[#EED8AA]/70 bg-muted shadow-sm">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={`${group.name} 头图`}
              className="size-full object-cover"
            />
          ) : (
            <div className="butter-placeholder flex size-full items-center justify-center">
              <ImageIcon className="size-10" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              组内投票：{group.name}
            </h1>
            <p className="mt-3 text-muted-foreground">
              {group.description || "在这一页完成活动组内所有开放投票。"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              真爱票额度 {group.love_vote_quota} 张，权重 x{group.love_vote_weight}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/groups/${group.id}`}>返回活动组</Link>
          </Button>
        </div>
      </div>

      {tournamentBrackets.length > 0 ? (
        <div className="mb-8 space-y-5">
          {tournamentBrackets.map((bracket) => (
            <TournamentBracket
              key={bracket.tournament.id}
              bracket={bracket}
              contestHrefById={contestHrefById}
            />
          ))}
        </div>
      ) : null}

      {contestsWithCandidates.length > 0 ? (
        <GroupVoteForm
          group={group}
          contests={contestsWithCandidates}
          usedLoveVotes={usedLoveVotes ?? 0}
        />
      ) : (
        <div className="rounded-2xl border p-8 text-muted-foreground">
          当前活动组暂无可投票活动。请返回活动组查看提名或结果阶段。
        </div>
      )}
    </div>
  );
}
