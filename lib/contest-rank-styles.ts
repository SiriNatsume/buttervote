export const contestRankStyles = [
  {
    row: "border-[#D5B24C] bg-[#FFF8D9]",
    badge: "bg-[#D4A72C] text-[#3F2D00]",
  },
  {
    row: "border-[#B9BEC5] bg-[#F4F5F6]",
    badge: "bg-[#B8BDC4] text-[#272B30]",
  },
  {
    row: "border-[#C38A5A] bg-[#FFF0E4]",
    badge: "bg-[#B8733F] text-white",
  },
  {
    row: "border-[#A8C8AD] bg-[#F1FAF2]",
    badge: "bg-[#BFDDBF] text-[#2F6139]",
  },
] as const;

export const defaultContestRankBadgeStyle = "bg-[#ECECEC] text-[#2F2F2F]";

export function formatContestOrdinal(rank: number) {
  const modulo100 = rank % 100;
  if (modulo100 >= 11 && modulo100 <= 13) return `${rank}th`;
  if (rank % 10 === 1) return `${rank}st`;
  if (rank % 10 === 2) return `${rank}nd`;
  if (rank % 10 === 3) return `${rank}rd`;
  return `${rank}th`;
}
