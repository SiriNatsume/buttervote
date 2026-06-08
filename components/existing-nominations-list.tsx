"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/time";
import type { Nomination, NominationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const nominationStatusLabel: Record<NominationStatus, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
};

export type ExistingNomination = Pick<
  Nomination,
  | "id"
  | "name"
  | "description"
  | "status"
  | "nominator_display_name"
  | "created_at"
>;

export function ExistingNominationsList({
  nominations,
  showNominatorInfo,
  defaultOpen = false,
  className,
}: {
  nominations: ExistingNomination[];
  showNominatorInfo: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const pendingOrder = new Map(
    nominations
      .filter((nomination) => nomination.status === "pending")
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
      .map((nomination, index) => [nomination.id, index + 1]),
  );

  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border border-[#EED8AA]/70 bg-[#FFFCF4]/85 shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-[#FFF3D0]/60 sm:px-5"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-5 shrink-0 text-primary" />
        ) : (
          <ChevronRight className="mt-0.5 size-5 shrink-0 text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">已有提名</h2>
            <Badge variant="secondary">{nominations.length} 条</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            如果出现重复提名，管理员可能会参考提交顺序决定通过哪个提名。
          </p>
        </div>
      </button>
      <div
        className={cn(
          "border-t border-[#EED8AA]/70 p-4 sm:p-5",
          open ? "block" : "hidden",
        )}
      >
        {nominations.length > 0 ? (
          <div className="space-y-3">
            {nominations.map((nomination) => {
              const pendingPosition = pendingOrder.get(nomination.id);

              return (
                <div
                  key={nomination.id}
                  className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/75 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words font-medium">
                        {nomination.name}
                      </div>
                      <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
                        {nomination.description || "暂无简介。"}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      <Badge variant="secondary">
                        {nominationStatusLabel[nomination.status]}
                      </Badge>
                      {pendingPosition ? (
                        <span className="text-xs text-muted-foreground">
                          待审核第 {pendingPosition} 位
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {showNominatorInfo && nomination.nominator_display_name ? (
                      <span>提名者：{nomination.nominator_display_name}</span>
                    ) : null}
                    <span>提交时间：{formatDateTime(nomination.created_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border p-5 text-sm text-muted-foreground">
            暂无已有提名。
          </div>
        )}
      </div>
    </section>
  );
}
