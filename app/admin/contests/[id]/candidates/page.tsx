import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createCandidateByAdmin,
  restoreCandidateByAdmin,
  updateCandidateByAdmin,
} from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { CandidateImageUploader } from "@/components/candidate-image-uploader";
import { DeleteCandidateDialog } from "@/components/delete-candidate-dialog";
import { DescriptionTextarea } from "@/components/description-textarea";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Candidate, Vote } from "@/lib/types";

function payloadIncludesCandidate(vote: Vote, candidateId: string) {
  const payload = vote.payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const record = payload as Record<string, unknown>;
  return (
    record.candidateId === candidateId ||
    (Array.isArray(record.candidateIds) &&
      record.candidateIds.includes(candidateId)) ||
    (Array.isArray(record.ranking) && record.ranking.includes(candidateId))
  );
}

function CandidateEditCard({
  contestId,
  descriptionMaxLength,
  candidate,
  hasVotes,
}: {
  contestId: string;
  descriptionMaxLength?: number | null;
  candidate: Candidate;
  hasVotes: boolean;
}) {
  return (
    <Card className="transition hover:border-orange-200 hover:shadow-md">
      <CardContent className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_240px]">
        <TransitionActionForm
          action={updateCandidateByAdmin}
          className="space-y-4"
          successMessage="候选项已保存"
        >
          <input type="hidden" name="contestId" value={contestId} />
          <input type="hidden" name="candidateId" value={candidate.id} />
          <div className="space-y-2">
            <Label htmlFor={`name-${candidate.id}`}>名称</Label>
            <Input
              id={`name-${candidate.id}`}
              name="name"
              required
              defaultValue={candidate.name}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`description-${candidate.id}`}>简介</Label>
            <DescriptionTextarea
              id={`description-${candidate.id}`}
              name="description"
              defaultValue={candidate.description ?? ""}
              maxLength={descriptionMaxLength}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`nominator-${candidate.id}`}>提名者</Label>
            <Input
              id={`nominator-${candidate.id}`}
              name="nominator_display_name"
              defaultValue={candidate.nominator_display_name ?? ""}
            />
          </div>
          {hasVotes ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              该候选项已有历史投票，删除时会软删除并保留历史数据。
            </div>
          ) : null}
          <FormSubmitButton className="w-full sm:w-auto" loadingText="保存中...">
            保存
          </FormSubmitButton>
        </TransitionActionForm>
        <div className="space-y-4">
          <CandidateImageUploader
            candidateId={candidate.id}
            value={{
              imagePath: candidate.image_path,
              imageWidth: candidate.image_width,
              imageHeight: candidate.image_height,
              imageSize: candidate.image_size,
            }}
          />
          <DeleteCandidateDialog
            candidateId={candidate.id}
            candidateName={candidate.name}
            hasVotes={hasVotes}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export default async function AdminContestCandidatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; deleted?: string }>;
}) {
  await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const supabase = await createServerDataClient();
  const [{ data: contest }, { data: candidates }, { data: votes }] =
    await Promise.all([
      supabase
        .from("contests")
        .select("id,title,candidate_description_max_length")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("candidates")
        .select(
          "id,contest_id,nomination_id,name,description,image_path,image_width,image_height,image_size,nominator_display_name,nominator_note,inherited_from_candidate_id,is_active,deleted_at,created_at",
        )
        .eq("contest_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("votes")
        .select("id,contest_id,voter_id,payload,created_at")
        .eq("contest_id", id),
    ]);

  if (!contest) {
    notFound();
  }

  const activeCandidates = (candidates ?? []).filter(
    (candidate) => candidate.is_active !== false,
  );
  const deletedCandidates = (candidates ?? []).filter(
    (candidate) => candidate.is_active === false,
  );
  const hasVotesByCandidate = new Map(
    (candidates ?? []).map((candidate) => [
      candidate.id,
      (votes ?? []).some((vote) => payloadIncludesCandidate(vote, candidate.id)),
    ]),
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">管理选项</h1>
          <p className="mt-3 break-words text-muted-foreground">
            {contest.title}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button asChild variant="outline">
            <Link href={`/admin/contests/${contest.id}/edit`}>编辑活动</Link>
          </Button>
          <Button asChild>
            <Link href={`/contests/${contest.id}`}>打开活动</Link>
          </Button>
        </div>
      </div>

      {query.error ? (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {query.error}
        </div>
      ) : null}
      {query.saved ? (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          已保存。
        </div>
      ) : null}
      {query.deleted ? (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          已软删除候选项。
        </div>
      ) : null}

      <Card className="mb-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle>新增候选项</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <TransitionActionForm
            action={createCandidateByAdmin}
            className="space-y-4"
            successMessage="候选项已添加"
            resetOnSuccess
          >
            <input type="hidden" name="contestId" value={contest.id} />
            <div className="space-y-2">
              <Label htmlFor="name">名称</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">简介</Label>
              <DescriptionTextarea
                id="description"
                name="description"
                maxLength={contest.candidate_description_max_length}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nominator_display_name">提名者</Label>
              <Input
                id="nominator_display_name"
                name="nominator_display_name"
              />
            </div>
            <FormSubmitButton className="w-full sm:w-auto" loadingText="保存中...">
              添加候选项
            </FormSubmitButton>
          </TransitionActionForm>
        </CardContent>
      </Card>

      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">当前候选项</h2>
        <Badge variant="secondary">{activeCandidates.length}</Badge>
      </div>

      {activeCandidates.length > 0 ? (
        <div className="space-y-5">
          {activeCandidates.map((candidate) => (
            <CandidateEditCard
              key={candidate.id}
              contestId={contest.id}
              descriptionMaxLength={contest.candidate_description_max_length}
              candidate={candidate}
              hasVotes={hasVotesByCandidate.get(candidate.id) ?? false}
            />
          ))}
        </div>
      ) : (
        <div className="butter-panel p-8 text-muted-foreground">
          当前活动暂无候选项。请先添加候选项，用户才能进入投票。
        </div>
      )}

      <details className="mt-8 rounded-3xl border border-[#EED8AA]/70 bg-[#FFFCF4]/80 p-5 shadow-sm">
        <summary className="cursor-pointer font-medium">
          已删除候选项（{deletedCandidates.length}）
        </summary>
        {deletedCandidates.length > 0 ? (
          <div className="mt-4 space-y-3">
            {deletedCandidates.map((candidate) => (
              <div
                key={candidate.id}
                className="flex flex-col justify-between gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <div className="break-words font-medium">{candidate.name}</div>
                  <div className="break-words text-sm text-muted-foreground">
                    {candidate.description || "暂无简介。"}
                  </div>
                </div>
                <TransitionActionForm
                  action={restoreCandidateByAdmin}
                  successMessage="候选项已恢复"
                >
                  <input type="hidden" name="candidateId" value={candidate.id} />
                  <FormSubmitButton
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    loadingText="保存中..."
                  >
                    恢复
                  </FormSubmitButton>
                </TransitionActionForm>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 text-sm text-muted-foreground">暂无已删除候选项。</div>
        )}
      </details>
    </div>
  );
}
