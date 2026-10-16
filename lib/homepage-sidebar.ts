import type { GroupHomepageContest } from "@/lib/group-homepage";
import { canNominateByStatus } from "@/lib/contest-rules";
import { contestVoteHref } from "@/lib/vote-entry";
import { selectedCandidateIdsFromVotePayload } from "@/lib/vote-payload";
import type { Candidate, Contest, ContestGroup, LoveVoteAllocation, Nomination, SiteNavigationValue, Vote } from "@/lib/types";

export type HomepageVotingContest = Pick<
  Contest,
  | "id"
  | "title"
  | "description"
  | "image_path"
  | "status"
  | "vote_type"
  | "live_results_enabled"
  | "group_id"
  | "show_candidate_image"
  | "love_vote_enabled"
  | "max_nominations_per_user"
  | "voting_starts_at"
  | "voting_ends_at"
  | "updated_at"
>;

export type HomepageVotingGroup = Pick<
  ContestGroup,
  "id" | "name" | "access_mode" | "love_vote_quota" | "love_vote_weight"
>;

export type HomepageSidebarMatch = {
  id: string;
  title: string;
  groupName: string | null;
  voteType: Contest["vote_type"];
  endsAt: string | null;
  detailHref: string;
  voteHref: string;
  canParticipate: boolean;
  hasVoted: boolean | null;
  card: GroupHomepageContest | null;
};

export type HomepageSidebarData = {
  signedIn: boolean;
  personalDataAvailable: boolean;
  nominationDataAvailable: boolean;
  matches: HomepageSidebarMatch[];
  eligibleCount: number;
  votedCount: number;
  pendingCount: number;
  actionHref: string | null;
  canSupplementLoveVote: boolean;
  remainingNominationCount: number | null;
  // Submitted history includes rejected and archived items, but not drafts.
  nominatedCount: number;
  nominationActionHref: string | null;
  nominationHistoryHref: string | null;
  canNominate: boolean;
  loveBalances: Array<{ id: string; name: string; remaining: number }> | null;
  referenceNow: number;
};

export function homepageActionHref(signedIn: boolean, target: string) {
  const returnTo = target.startsWith("#") ? `/${target}` : target;
  return signedIn ? returnTo : `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function isHomepageVotingOpen(
  contest: HomepageVotingContest,
  now: number,
) {
  return (
    contest.status === "voting" &&
    (!contest.voting_starts_at || Date.parse(contest.voting_starts_at) <= now) &&
    (!contest.voting_ends_at || Date.parse(contest.voting_ends_at) > now)
  );
}

export function buildHomepageSidebarData(input: {
  contests: HomepageVotingContest[];
  groups: HomepageVotingGroup[];
  cards: GroupHomepageContest[];
  activeCandidates: Array<Pick<Candidate, "id" | "contest_id">>;
  navigation: SiteNavigationValue;
  signedIn: boolean;
  isAdmin: boolean;
  allowedGroupIds: string[];
  votes: Array<Pick<Vote, "id" | "contest_id" | "payload">>;
  loveAllocations: Array<Pick<LoveVoteAllocation, "group_id" | "vote_id" | "candidate_id">>;
  nominations: Array<Pick<Nomination, "contest_id" | "status">>;
  personalDataAvailable: boolean;
  loveDataAvailable: boolean;
  nominationDataAvailable: boolean;
  referenceNow: number;
}): HomepageSidebarData {
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  const allowedGroups = new Set(input.allowedGroupIds);
  const votesByContest = new Map(input.votes.map((vote) => [vote.contest_id, vote]));
  const cardsByContest = new Map(input.cards.map((card) => [card.id, card]));
  const activeCandidatesByContest = new Map<string, Set<string>>();
  for (const candidate of input.activeCandidates) {
    const candidates = activeCandidatesByContest.get(candidate.contest_id) ?? new Set<string>();
    candidates.add(candidate.id);
    activeCandidatesByContest.set(candidate.contest_id, candidates);
  }
  const canAccessContest = (contest: HomepageVotingContest) => {
    const group = contest.group_id ? groups.get(contest.group_id) : null;
    return !contest.group_id || Boolean(
      group && (group.access_mode === "public" || input.isAdmin || allowedGroups.has(group.id)),
    );
  };

  const eligibleGroupIds = new Set<string>();
  const matches = input.contests
    .filter((contest) => isHomepageVotingOpen(contest, input.referenceNow))
    .map((contest): HomepageSidebarMatch => {
      const group = contest.group_id ? groups.get(contest.group_id) : null;
      const canParticipate =
        input.signedIn &&
        input.personalDataAvailable &&
        canAccessContest(contest);
      if (
        canParticipate &&
        group &&
        contest.love_vote_enabled &&
        group.love_vote_quota > 0 &&
        group.love_vote_weight > 1
      ) {
        eligibleGroupIds.add(group.id);
      }
      const card = cardsByContest.get(contest.id);
      return {
        id: contest.id,
        title: contest.title,
        groupName: group?.name ?? null,
        voteType: contest.vote_type,
        endsAt: contest.voting_ends_at,
        detailHref: `/contests/${contest.id}`,
        voteHref: contestVoteHref(contest.id, contest.group_id),
        canParticipate,
        hasVoted:
          input.signedIn && input.personalDataAvailable
            ? votesByContest.has(contest.id)
            : null,
        card: card
          ? {
              ...card,
              participants: card.participants.map((participant) => ({
                ...participant,
                imageUrl: contest.show_candidate_image ? participant.imageUrl : null,
              })),
            }
          : null,
      };
    })
    .sort((left, right) => {
      const priority = (match: HomepageSidebarMatch) =>
        match.canParticipate ? (match.hasVoted ? 1 : 0) : 2;
      return (
        priority(left) - priority(right) ||
        (left.endsAt ? Date.parse(left.endsAt) : Infinity) -
          (right.endsAt ? Date.parse(right.endsAt) : Infinity) ||
        left.title.localeCompare(right.title, "zh-CN", { numeric: true })
      );
    });
  const eligible = matches.filter((match) => match.canParticipate);
  const pending = eligible.filter((match) => !match.hasVoted);
  const usedLoveByGroup = new Map<string, number>();
  const lovedCandidatesByVote = new Map<string, Set<string>>();
  for (const allocation of input.loveAllocations) {
    const groupId = allocation.group_id;
    if (groupId) usedLoveByGroup.set(groupId, (usedLoveByGroup.get(groupId) ?? 0) + 1);
    const candidates = lovedCandidatesByVote.get(allocation.vote_id) ?? new Set<string>();
    candidates.add(allocation.candidate_id);
    lovedCandidatesByVote.set(allocation.vote_id, candidates);
  }

  const votingGroup = input.navigation.resultsGroupId
    ? groups.get(input.navigation.resultsGroupId)
    : null;
  const canSupplementLoveVote = Boolean(
    input.signedIn && input.personalDataAvailable && input.loveDataAvailable &&
    votingGroup && votingGroup.love_vote_weight > 1 &&
    votingGroup.love_vote_quota > (usedLoveByGroup.get(votingGroup.id) ?? 0) &&
    input.contests.some((contest) => {
      if (
        contest.group_id !== votingGroup.id || !contest.love_vote_enabled ||
        !isHomepageVotingOpen(contest, input.referenceNow) || !canAccessContest(contest)
      ) return false;

      const vote = votesByContest.get(contest.id);
      if (!vote) return false;
      const selected = new Set(selectedCandidateIdsFromVotePayload(contest.vote_type, vote.payload));
      const loved = lovedCandidatesByVote.get(vote.id);
      const active = activeCandidatesByContest.get(contest.id);
      return [...selected].some((candidateId) => active?.has(candidateId) && !loved?.has(candidateId));
    }),
  );

  const nominationContest = input.contests.find(
    (contest) => contest.id === input.navigation.nominationContestId,
  );
  const ownNominations = input.nominations.filter(
    (nomination) => nomination.contest_id === input.navigation.nominationContestId,
  );
  // Drafts reserve a place; rejected items release their quota but remain in
  // the submitted history for this configured activity.
  const usedNominations = input.signedIn
    ? ownNominations.filter((nomination) => nomination.status !== "rejected").length
    : 0;
  const nominationOpen = Boolean(
    nominationContest &&
    canNominateByStatus(nominationContest, input.isAdmin ? { role: "admin" } : null) &&
    canAccessContest(nominationContest),
  );
  const availableNominations = nominationOpen && nominationContest
    ? input.isAdmin || nominationContest.max_nominations_per_user === null
      ? Infinity
      : Math.max(0, nominationContest.max_nominations_per_user - usedNominations)
    : 0;
  const showNominations = input.signedIn && input.nominationDataAvailable;
  const remainingNominations = showNominations ? availableNominations : 0;
  const canNominate = nominationOpen &&
    (!input.signedIn || input.nominationDataAvailable) &&
    availableNominations > 0;

  return {
    signedIn: input.signedIn,
    personalDataAvailable: input.personalDataAvailable,
    nominationDataAvailable: input.nominationDataAvailable,
    matches,
    eligibleCount: eligible.length,
    votedCount: eligible.length - pending.length,
    pendingCount: pending.length,
    actionHref: input.navigation.resultsGroupId
      ? `/groups/${input.navigation.resultsGroupId}/vote`
      : input.navigation.resultsContestId
        ? contestVoteHref(input.navigation.resultsContestId, input.contests.find((contest) => contest.id === input.navigation.resultsContestId)?.group_id ?? null)
      : null,
    canSupplementLoveVote,
    remainingNominationCount: Number.isFinite(remainingNominations) ? remainingNominations : null,
    nominatedCount: showNominations ? ownNominations.filter((nomination) => nomination.status !== "draft").length : 0,
    nominationActionHref: input.navigation.nominationContestId
      ? `/contests/${input.navigation.nominationContestId}/nominate`
      : null,
    nominationHistoryHref: input.navigation.nominationContestId
      ? `/contests/${input.navigation.nominationContestId}/my-nominations`
      : null,
    canNominate,
    loveBalances:
      input.signedIn && input.personalDataAvailable && input.loveDataAvailable
        ? input.groups
            .filter((group) => eligibleGroupIds.has(group.id))
            .map((group) => ({
              id: group.id,
              name: group.name,
              remaining: Math.max(
                0,
                group.love_vote_quota - (usedLoveByGroup.get(group.id) ?? 0),
              ),
            }))
        : null,
    referenceNow: input.referenceNow,
  };
}
