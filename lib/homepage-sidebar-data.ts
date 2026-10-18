import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentProfile } from "@/lib/auth";
import { canNominateByStatus } from "@/lib/contest-rules";
import { loadGroupHomepageContests } from "@/lib/group-homepage-data";
import {
  buildHomepageSidebarData,
  isHomepageVotingOpen,
  type HomepageVotingContest,
  type HomepageVotingGroup,
} from "@/lib/homepage-sidebar";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { getSiteNavigationSettings } from "@/lib/site-navigation";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { selectedCandidateIdsFromVotePayload } from "@/lib/vote-payload";
import type { Candidate, Database, LoveVoteAllocation, Nomination, Vote } from "@/lib/types";

export async function loadHomepageSidebarData(input: {
  publicClient: SupabaseClient<Database>;
  contests: HomepageVotingContest[];
  groups: HomepageVotingGroup[];
}) {
  const referenceNow = Date.now();
  const activeContests = input.contests.filter((contest) =>
    isHomepageVotingOpen(contest, referenceNow),
  );
  const contestIds = activeContests.map((contest) => contest.id);
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  const [profile, cards, navigation] = await Promise.all([
    getCurrentProfile(),
    loadGroupHomepageContests({
      publicClient: input.publicClient,
      contests: activeContests,
      loveVoteWeight: new Map(activeContests.map((contest) => [
        contest.id,
        (contest.group_id && groupsById.get(contest.group_id)?.love_vote_weight) || 1,
      ])),
    }),
    getSiteNavigationSettings(),
  ]);
  const nominationContestId = navigation.nominationContestId;

  const data = {
    ...input,
    cards,
    activeCandidates: [] as Array<Pick<Candidate, "id" | "contest_id">>,
    navigation,
    signedIn: Boolean(profile),
    isAdmin: profile?.role === "admin",
    allowedGroupIds: [] as string[],
    votes: [] as Array<Pick<Vote, "id" | "contest_id" | "payload">>,
    loveAllocations: [] as Array<Pick<LoveVoteAllocation, "group_id" | "vote_id" | "candidate_id">>,
    nominations: [] as Array<Pick<Nomination, "contest_id" | "status">>,
    personalDataAvailable: true,
    loveDataAvailable: true,
    nominationDataAvailable: true,
    referenceNow,
  };
  if (!profile) return buildHomepageSidebarData(data);

  // QQ sessions use server-side identity checks. Every private query is scoped
  // to this authenticated profile; public candidates keep using the RLS client.
  const privateClient = await createServerDataClient();
  const activeGroupIds = new Set(
    input.contests
      .filter((contest) => isHomepageVotingOpen(contest, referenceNow) || canNominateByStatus(contest, profile))
      .flatMap((contest) => (contest.group_id ? [contest.group_id] : [])),
  );
  const restrictedGroupIds = input.groups
    .filter((group) => activeGroupIds.has(group.id) && group.access_mode === "restricted")
    .map((group) => group.id);
  const needsMemberships = profile.role !== "admin" && restrictedGroupIds.length > 0;
  const [voteResult, loveResult, allowedResult, membershipResult, nominationResult] = await Promise.all([
    contestIds.length
      ? fetchAllRows(() =>
          privateClient
            .from("votes")
            .select("id,contest_id,payload", { count: "exact" })
            .eq("voter_id", profile.id)
            .in("contest_id", contestIds)
            .order("id", { ascending: true }),
        )
      : { data: [], error: null },
    activeGroupIds.size
      ? fetchAllRows(() =>
          privateClient
            .from("love_vote_allocations")
            .select("group_id,vote_id,candidate_id", { count: "exact" })
            .eq("voter_id", profile.id)
            .in("group_id", [...activeGroupIds])
            .order("id", { ascending: true }),
        )
      : { data: [], error: null },
    needsMemberships
      ? fetchAllRows(() => privateClient
          .from("contest_group_allowed_user_groups")
          .select("contest_group_id,user_group_id", { count: "exact" })
          .in("contest_group_id", restrictedGroupIds).order("id"))
      : { data: [], error: null },
    needsMemberships
      ? fetchAllRows(() => privateClient
          .from("user_group_members")
          .select("user_group_id", { count: "exact" })
          .eq("profile_id", profile.id)
          .is("revoked_at", null)
          .gt("expires_at", new Date(referenceNow).toISOString()).order("id"))
      : { data: [], error: null },
    nominationContestId
      ? fetchAllRows(() =>
          privateClient
            .from("nominations")
            .select("contest_id,status", { count: "exact" })
            .eq("submitter_id", profile.id)
            .eq("contest_id", nominationContestId)
            .order("id", { ascending: true }),
        )
      : { data: [], error: null },
  ]);
  for (const [name, result] of [
    ["votes", voteResult],
    ["love votes", loveResult],
    ["group access", allowedResult],
    ["memberships", membershipResult],
    ["nominations", nominationResult],
  ] as const) {
    if (result.error) console.error(`[homepage-sidebar] ${name}: ${result.error.message}`);
  }
  const memberships = new Set(
    (membershipResult.data ?? []).map((row) => row.user_group_id),
  );
  const votesByContest = new Map((voteResult.data ?? []).map((vote) => [vote.contest_id, vote]));
  const supplementContests = activeContests.filter(
    (contest) => contest.group_id === navigation.resultsGroupId && contest.love_vote_enabled,
  );
  const selectedCandidateIds = [...new Set(supplementContests.flatMap((contest) => {
    const vote = votesByContest.get(contest.id);
    return vote ? selectedCandidateIdsFromVotePayload(contest.vote_type, vote.payload) : [];
  }))];
  const candidateResult = selectedCandidateIds.length > 0 && !voteResult.error && !loveResult.error
    ? await fetchAllRows(() =>
        (profile.role === "admin" ? privateClient : input.publicClient)
          .from("candidates")
          .select("id,contest_id", { count: "exact" })
          .in("id", selectedCandidateIds)
          .in("contest_id", supplementContests.map((contest) => contest.id))
          .eq("is_active", true)
          .order("id", { ascending: true }),
      )
    : { data: [], error: null };
  if (candidateResult.error) {
    console.error(`[homepage-sidebar] supplement candidates: ${candidateResult.error.message}`);
  }
  return buildHomepageSidebarData({
    ...data,
    allowedGroupIds: (allowedResult.data ?? [])
      .filter((row) => memberships.has(row.user_group_id))
      .map((row) => row.contest_group_id),
    votes: voteResult.data ?? [],
    activeCandidates: candidateResult.data ?? [],
    // Include allocations from earlier rounds: the quota belongs to the group.
    loveAllocations: loveResult.data ?? [],
    personalDataAvailable: !voteResult.error && !allowedResult.error && !membershipResult.error,
    loveDataAvailable: !loveResult.error,
    nominations: nominationResult.data ?? [],
    nominationDataAvailable: !nominationResult.error && !allowedResult.error && !membershipResult.error,
  });
}
