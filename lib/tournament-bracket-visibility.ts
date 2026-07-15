export type BracketVisibilityMatch = {
  id: string;
  round: string;
  left_entry_id: string | null;
  right_entry_id: string | null;
  winner_entry_id: string | null;
  loser_entry_id: string | null;
};

export type BracketVisibilityCandidate = {
  id: string;
  contest_id: string;
  inherited_from_candidate_id: string | null;
};

const ROUND_INDEX = new Map(
  ["round_of_16", "quarterfinal", "semifinal", "final", "third_place"].map(
    (round, index) => [round, index] as const,
  ),
);

function roundIndex(round: string) {
  return ROUND_INDEX.get(round) ?? Number.MAX_SAFE_INTEGER;
}

export function hiddenOutcomeRoundByEntry(
  matches: readonly BracketVisibilityMatch[],
  resultVisibleByMatch: ReadonlyMap<string, boolean>,
) {
  const hiddenRoundByEntry = new Map<string, number>();

  for (const match of matches) {
    if (resultVisibleByMatch.get(match.id) === true) {
      continue;
    }

    const sourceRound = roundIndex(match.round);
    for (const entryId of [match.winner_entry_id, match.loser_entry_id]) {
      if (!entryId) {
        continue;
      }

      hiddenRoundByEntry.set(
        entryId,
        Math.min(hiddenRoundByEntry.get(entryId) ?? sourceRound, sourceRound),
      );
    }
  }

  return hiddenRoundByEntry;
}

export function entryOutcomeIsHiddenInMatch(
  entryId: string,
  match: Pick<BracketVisibilityMatch, "round">,
  hiddenRoundByEntry: ReadonlyMap<string, number>,
) {
  const hiddenSourceRound = hiddenRoundByEntry.get(entryId);
  return (
    hiddenSourceRound !== undefined && hiddenSourceRound < roundIndex(match.round)
  );
}

export function inheritedCandidateIsPublic(
  candidateId: string,
  candidates: ReadonlyMap<string, BracketVisibilityCandidate>,
  fullResultVisibleContestIds: ReadonlySet<string>,
) {
  const visitedCandidateIds = new Set<string>();
  let candidate = candidates.get(candidateId);

  while (candidate) {
    if (visitedCandidateIds.has(candidate.id)) {
      return false;
    }
    visitedCandidateIds.add(candidate.id);

    if (!candidate.inherited_from_candidate_id) {
      return true;
    }

    const sourceCandidate = candidates.get(candidate.inherited_from_candidate_id);
    if (
      !sourceCandidate ||
      !fullResultVisibleContestIds.has(sourceCandidate.contest_id)
    ) {
      return false;
    }
    candidate = sourceCandidate;
  }

  return false;
}

export function resolveBracketResultVisibility<
  TMatch extends BracketVisibilityMatch,
>(
  matches: readonly TMatch[],
  canonicalResultVisibleByMatch: ReadonlyMap<string, boolean>,
  participantIsPublic: (
    entryId: string,
    match: TMatch,
    hiddenRoundByEntry: ReadonlyMap<string, number>,
  ) => boolean,
) {
  const resultVisibleByMatch = new Map(
    matches.map(
      (match) =>
        [match.id, canonicalResultVisibleByMatch.get(match.id) === true] as const,
    ),
  );
  let hiddenRoundByEntry = hiddenOutcomeRoundByEntry(
    matches,
    resultVisibleByMatch,
  );

  for (let pass = 0; pass <= matches.length; pass += 1) {
    let changed = false;

    for (const match of matches) {
      if (resultVisibleByMatch.get(match.id) !== true) {
        continue;
      }

      const participantIds = [match.left_entry_id, match.right_entry_id].filter(
        (entryId): entryId is string => Boolean(entryId),
      );
      const publicParticipantIds = new Set(
        participantIds.filter((entryId) =>
          participantIsPublic(entryId, match, hiddenRoundByEntry),
        ),
      );
      const allParticipantsPublic = participantIds.every((entryId) =>
        publicParticipantIds.has(entryId),
      );
      const allOutcomesPublic = [
        match.winner_entry_id,
        match.loser_entry_id,
      ].every((entryId) => !entryId || publicParticipantIds.has(entryId));

      if (!allParticipantsPublic || !allOutcomesPublic) {
        resultVisibleByMatch.set(match.id, false);
        changed = true;
      }
    }

    if (!changed) {
      break;
    }

    hiddenRoundByEntry = hiddenOutcomeRoundByEntry(
      matches,
      resultVisibleByMatch,
    );
  }

  return {
    resultVisibleByMatch,
    hiddenRoundByEntry: hiddenOutcomeRoundByEntry(
      matches,
      resultVisibleByMatch,
    ),
  };
}

export function latestBracketVersion(
  timestamps: readonly (string | null | undefined)[],
) {
  const latest = timestamps.reduce((current, timestamp) => {
    const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
    return Number.isFinite(parsed) ? Math.max(current, parsed) : current;
  }, 0);

  return String(latest);
}
