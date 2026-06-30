export const BRACKET_IMAGE_WIDTH = 2400;
export const BRACKET_IMAGE_HEIGHT = 1350;

export type BracketImageRound =
  | "round_of_16"
  | "quarterfinal"
  | "semifinal"
  | "final"
  | "third_place";

export type BracketImageContest = {
  id: string;
  title: string;
  status: string;
};

export type BracketImageParticipant = {
  entryId: string;
  name: string;
  imagePath: string | null;
  preliminaryGroup: "A" | "B" | "C" | "D" | null;
  preliminaryRank: number | null;
  screeningRank: number | null;
  score: number | null;
  isWinner: boolean;
};

export type BracketImageMatch = {
  id: string;
  round: BracketImageRound;
  roundLabel: string;
  slot: number;
  contest: BracketImageContest | null;
  left: BracketImageParticipant | null;
  right: BracketImageParticipant | null;
  resultVisible: boolean;
  winnerEntryId: string | null;
  loserEntryId: string | null;
};

export type BracketImageData = {
  tournamentId: string;
  tournamentName: string;
  groupId: string;
  groupName: string;
  generatedAt: string;
  matches: BracketImageMatch[];
};
