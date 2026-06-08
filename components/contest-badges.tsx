import type { ContestStatus, VoteType } from "@/lib/types";
import { statusLabel, voteTypeLabel } from "@/lib/contest-rules";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const statusBadgeClass: Record<ContestStatus, string> = {
  draft: "border-stone-200 bg-stone-100 text-stone-700",
  nominating: "border-amber-200 bg-amber-100 text-amber-800",
  admin_nominating: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  waiting: "border-[#DFC28E] bg-[#F7E6C5] text-[#6A4A2B]",
  voting: "border-orange-200 bg-orange-100 text-orange-800",
  closed: "border-stone-300 bg-stone-100 text-stone-600",
  published: "border-yellow-300 bg-yellow-100 text-yellow-800",
};

const voteTypeBadgeClass: Record<VoteType, string> = {
  single: "border-orange-300 bg-white/50 text-orange-800",
  multiple: "border-yellow-300 bg-white/50 text-yellow-800",
  ranked: "border-[#B9854C] bg-white/50 text-[#6A3E21]",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ContestStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(statusBadgeClass[status], className)}>
      {statusLabel[status]}
    </Badge>
  );
}

export function VoteTypeBadge({
  voteType,
  className,
}: {
  voteType: VoteType;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(voteTypeBadgeClass[voteType], className)}>
      {voteTypeLabel[voteType]}
    </Badge>
  );
}

