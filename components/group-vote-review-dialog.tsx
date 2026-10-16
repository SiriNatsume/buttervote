"use client";

import { useRef } from "react";
import { Heart, Pencil, Send } from "lucide-react";
import { LoadingButton } from "@/components/loading-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VoteType } from "@/lib/types";

export type GroupVoteReviewItem = {
  contestId: string;
  title: string;
  voteType: VoteType;
  choices: { id: string; name: string; love: boolean }[];
};

export function GroupVoteReviewDialog({
  open,
  items,
  loveVoteCount,
  loveVoteWeight,
  availableLoveVotes,
  loading,
  error,
  onOpenChange,
  onEdit,
  onConfirm,
}: {
  open: boolean;
  items: GroupVoteReviewItem[];
  loveVoteCount: number;
  loveVoteWeight: number;
  availableLoveVotes: number;
  loading: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (contestId: string) => void;
  onConfirm: () => void;
}) {
  const editTarget = useRef<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        onCloseAutoFocus={(event) => {
          if (editTarget.current) {
            event.preventDefault();
            onEdit(editTarget.current);
            editTarget.current = null;
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>核对选票</DialogTitle>
          <DialogDescription className="leading-6">
            本次将提交 {items.length} 场投票。请核对候选项与真爱票，提交后不可修改或撤回。
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {items.map((item, index) => (
            <li key={item.contestId} className="rounded-2xl border bg-white/50 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="mb-1 text-xs text-muted-foreground">第 {index + 1} 场</p>
                  <h3 className="break-words font-medium">{item.title}</h3>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  aria-label={`修改第 ${index + 1} 场：${item.title}`}
                  onClick={() => {
                    editTarget.current = item.contestId;
                    onOpenChange(false);
                  }}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                  修改
                </Button>
              </div>
              <ul className="space-y-2 text-sm">
                {item.choices.map((choice, choiceIndex) => (
                  <li key={choice.id} className="flex flex-wrap items-center gap-2">
                    {item.voteType === "ranked" ? (
                      <span className="text-xs text-muted-foreground">第 {choiceIndex + 1} 名</span>
                    ) : null}
                    <span className="min-w-0 break-words">{choice.name}</span>
                    {choice.love ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#FFE4EA] px-2 py-0.5 text-xs text-[#C73555]">
                        <Heart className="size-3 fill-current" aria-hidden="true" />
                        真爱票 ×{loveVoteWeight}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <p className="rounded-xl border border-[#FFB3C1]/70 bg-[#FFE4EA]/40 px-4 py-3 text-sm leading-6">
          本次使用真爱票 <strong>{loveVoteCount}</strong> 张，提交后剩余 {availableLoveVotes} 张。
          {loveVoteCount > 0 ? "真爱票额度有限，使用后不可撤回。" : null}
        </p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            返回修改
          </Button>
          <LoadingButton
            type="button"
            variant={loveVoteCount > 0 ? "loveParticipation" : "participation"}
            loading={loading}
            loadingText="正在提交组内投票..."
            onClick={onConfirm}
          >
            <Send className="size-4" aria-hidden="true" />
            确认提交 {items.length} 场
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
