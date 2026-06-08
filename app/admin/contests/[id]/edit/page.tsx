import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createScheduledTransition,
  deleteScheduledTransition,
  updateContestAction,
  updateContestSettings,
} from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import {
  closedResultVisibilityLabel,
  scheduledTransitionTargets,
  statusLabel,
  toDatetimeLocalValue,
} from "@/lib/contest-rules";
import { applyDueScheduledTransitionsForContest } from "@/lib/scheduled-transitions";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { formatDateTime } from "@/lib/time";
import { ClearableDatetimeInput } from "@/components/clearable-datetime-input";
import { ContestImageUploader } from "@/components/contest-image-uploader";
import { FormSubmitButton } from "@/components/form-submit-button";
import { InheritCandidatesForm } from "@/components/inherit-candidates-form";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export default async function EditContestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
    settingsSaved?: string;
    inherited?: string;
    scheduled?: string;
  }>;
}) {
  await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  await applyDueScheduledTransitionsForContest(id, { revalidate: false });
  const supabase = await createServerDataClient();
  const [{ data: contest }, { data: groups }, { data: scheduledTransitions }] =
    await Promise.all([
    supabase
      .from("contests")
      .select(
        "id,title,description,status,vote_type,max_choices,require_exact_choices,group_id,show_candidate_image,show_candidate_description,show_nominator_info,show_existing_nominations,max_nominations_per_user,candidate_description_max_length,live_results_enabled,closed_result_visibility,love_vote_enabled,voting_starts_at,voting_ends_at,image_path,image_width,image_height,image_size,created_by,created_at,updated_at",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("contest_groups")
      .select("id,name")
      .order("created_at", { ascending: false }),
    supabase
      .from("contest_scheduled_transitions")
      .select("id,contest_id,target_status,run_at,executed_at,created_by,created_at,updated_at")
      .eq("contest_id", id)
      .order("run_at", { ascending: true }),
  ]);

  if (!contest) {
    notFound();
  }

  let groupContests: Array<{ id: string; title: string }> = [];
  let groupCandidates: Array<{
    id: string;
    contest_id: string;
    name: string;
    description: string | null;
  }> = [];

  if (contest.group_id) {
    const { data: contestsInGroup } = await supabase
      .from("contests")
      .select("id,title")
      .eq("group_id", contest.group_id)
      .order("created_at", { ascending: true });
    groupContests = contestsInGroup ?? [];

    if (groupContests.length > 0) {
      const { data: candidatesInGroup } = await supabase
        .from("candidates")
        .select("id,contest_id,name,description")
        .in(
          "contest_id",
          groupContests.map((item) => item.id),
        )
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      groupCandidates = candidatesInGroup ?? [];
    }
  }

  const pendingTransitions = (scheduledTransitions ?? []).filter(
    (transition) => !transition.executed_at,
  );
  const executedTransitions = (scheduledTransitions ?? []).filter(
    (transition) => transition.executed_at,
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">编辑活动</h1>
          <p className="mt-3 break-words text-muted-foreground">
            {contest.title}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/admin">返回后台</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/admin/contests/${contest.id}/candidates`}>
              管理选项
            </Link>
          </Button>
          {contest.group_id ? (
            <Button asChild variant="outline">
              <Link href={`/admin/groups/${contest.group_id}`}>打开活动组</Link>
            </Button>
          ) : null}
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

      {query.settingsSaved ? (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          运营设置已保存。
        </div>
      ) : null}

      {query.scheduled ? (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          定时状态已更新。
        </div>
      ) : null}

      {query.inherited ? (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          已继承 {query.inherited} 个候选项。
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle>基础信息</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <TransitionActionForm
              action={updateContestAction}
              className="space-y-5"
              successMessage="活动已保存"
            >
              <input type="hidden" name="contestId" value={contest.id} />
              <div className="space-y-2">
                <Label htmlFor="title">标题</Label>
                <Input
                  id="title"
                  name="title"
                  required
                  defaultValue={contest.title}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">简介</Label>
                <Textarea
                  id="description"
                  name="description"
                  defaultValue={contest.description ?? ""}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>状态</Label>
                  <Select name="status" defaultValue={contest.status}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">草稿</SelectItem>
                      <SelectItem value="nominating">提名中</SelectItem>
                      <SelectItem value="admin_nominating">
                        管理员提名
                      </SelectItem>
                      <SelectItem value="waiting">等待开始</SelectItem>
                      <SelectItem value="voting">投票中</SelectItem>
                      <SelectItem value="closed">已结束</SelectItem>
                      <SelectItem value="published">已发布</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>投票类型</Label>
                  <Select name="vote_type" defaultValue={contest.vote_type}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">单选</SelectItem>
                      <SelectItem value="multiple">多选</SelectItem>
                      <SelectItem value="ranked">排名投票</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="max_choices">最多可选</Label>
                  <Input
                    id="max_choices"
                    name="max_choices"
                    type="number"
                    min={1}
                    required
                    defaultValue={contest.max_choices}
                  />
                </div>
                <Label className="flex items-center gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4">
                  <Checkbox
                    name="require_exact_choices"
                    defaultChecked={contest.require_exact_choices === true}
                  />
                  <span>
                    多选必须选满
                    <span className="block text-xs leading-5 text-muted-foreground">
                      仅多选投票生效，勾选后必须选择上方数量。
                    </span>
                  </span>
                </Label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label>活动组</Label>
                  <Select name="group_id" defaultValue={contest.group_id ?? "none"}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不属于活动组</SelectItem>
                      {(groups ?? []).map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4 sm:grid-cols-2">
                <Label className="flex items-center gap-3">
                  <Checkbox
                    name="show_candidate_image"
                    defaultChecked={contest.show_candidate_image !== false}
                  />
                  展示候选项图片
                </Label>
                <Label className="flex items-center gap-3">
                  <Checkbox
                    name="show_candidate_description"
                    defaultChecked={contest.show_candidate_description !== false}
                  />
                  展示候选项简介
                </Label>
              </div>
              <FormSubmitButton className="w-full sm:w-auto" loadingText="保存中...">
                保存
              </FormSubmitButton>
            </TransitionActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle>活动封面</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <ContestImageUploader
              contestId={contest.id}
              value={{
                imagePath: contest.image_path,
                imageWidth: contest.image_width,
                imageHeight: contest.image_height,
                imageSize: contest.image_size,
              }}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle>运营设置</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <TransitionActionForm
            action={updateContestSettings}
            className="space-y-5"
            successMessage="运营设置已保存"
          >
            <input type="hidden" name="contestId" value={contest.id} />
            <div className="grid gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4 sm:grid-cols-2">
              <Label className="flex items-center gap-3">
                <Checkbox
                  name="show_candidate_image"
                  defaultChecked={contest.show_candidate_image !== false}
                />
                展示候选项图片
              </Label>
              <Label className="flex items-center gap-3">
                <Checkbox
                  name="show_candidate_description"
                  defaultChecked={contest.show_candidate_description !== false}
                />
                展示候选项简介
              </Label>
              <Label className="flex items-center gap-3">
                <Checkbox
                  name="show_nominator_info"
                  defaultChecked={contest.show_nominator_info !== false}
                />
                展示提名者信息
              </Label>
              <Label className="flex items-center gap-3">
                <Checkbox
                  name="live_results_enabled"
                  defaultChecked={contest.live_results_enabled === true}
                />
                投票期间公开实时票数
              </Label>
              <Label className="flex items-center gap-3">
                <Checkbox
                  name="show_existing_nominations"
                  defaultChecked={contest.show_existing_nominations === true}
                />
                提名阶段展示已有提名
              </Label>
              <Label className="flex items-center gap-3">
                <Checkbox
                  name="love_vote_enabled"
                  defaultChecked={contest.love_vote_enabled !== false}
                />
                允许使用真爱票
              </Label>
            </div>
            <p className="-mt-2 text-sm text-muted-foreground">
              关闭后，即使所属活动组开启真爱票机制，用户也不能在该活动中使用真爱票。
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="max_nominations_per_user">
                  单用户最大提名数
                </Label>
                <Input
                  id="max_nominations_per_user"
                  name="max_nominations_per_user"
                  type="number"
                  min={0}
                  placeholder="留空表示不限制"
                  defaultValue={contest.max_nominations_per_user ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidate_description_max_length">
                  简介最大字数
                </Label>
                <Input
                  id="candidate_description_max_length"
                  name="candidate_description_max_length"
                  type="number"
                  min={1}
                  placeholder="留空表示不限制"
                  defaultValue={contest.candidate_description_max_length ?? ""}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>closed 后结果可见性</Label>
                <Select
                  name="closed_result_visibility"
                  defaultValue={contest.closed_result_visibility}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin_only">
                      {closedResultVisibilityLabel.admin_only}
                    </SelectItem>
                    <SelectItem value="public">
                      {closedResultVisibilityLabel.public}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="voting_starts_at">投票开始时间</Label>
                <ClearableDatetimeInput
                  id="voting_starts_at"
                  name="voting_starts_at"
                  defaultValue={toDatetimeLocalValue(contest.voting_starts_at)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="voting_ends_at">投票结束时间</Label>
                <ClearableDatetimeInput
                  id="voting_ends_at"
                  name="voting_ends_at"
                  defaultValue={toDatetimeLocalValue(contest.voting_ends_at)}
                />
              </div>
            </div>
            <FormSubmitButton className="w-full sm:w-auto" loadingText="保存中...">
              保存运营设置
            </FormSubmitButton>
          </TransitionActionForm>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle>定时状态</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
          <TransitionActionForm
            action={createScheduledTransition}
            className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]"
            successMessage="定时状态已更新"
            resetOnSuccess
          >
            <input type="hidden" name="contestId" value={contest.id} />
            <div className="space-y-2">
              <Label>目标状态</Label>
              <Select name="target_status" defaultValue="voting">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scheduledTransitionTargets.map((status) => (
                    <SelectItem key={status} value={status}>
                      {statusLabel[status as keyof typeof statusLabel]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="run_at">执行时间</Label>
              <ClearableDatetimeInput id="run_at" name="run_at" required />
            </div>
            <FormSubmitButton
              type="submit"
              className="w-full self-end sm:w-auto"
              disabled={pendingTransitions.length >= 2}
              loadingText="保存中..."
            >
              添加
            </FormSubmitButton>
          </TransitionActionForm>
          {pendingTransitions.length >= 2 ? (
            <div className="text-sm text-muted-foreground">
              每个活动最多配置两个未执行的定时状态。
            </div>
          ) : null}
          <div className="space-y-3">
            <h3 className="font-medium">未执行</h3>
            {pendingTransitions.length > 0 ? (
              pendingTransitions.map((transition) => (
                <div
                  key={transition.id}
                  className="flex flex-col justify-between gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/70 p-3 sm:flex-row sm:items-center"
                >
                  <div className="text-sm">
                    <span className="font-medium">
                      {statusLabel[transition.target_status]}
                    </span>{" "}
                    · {formatDateTime(transition.run_at)}
                  </div>
                  <TransitionActionForm
                    action={deleteScheduledTransition}
                    successMessage="定时状态已删除"
                  >
                    <input
                      type="hidden"
                      name="transitionId"
                      value={transition.id}
                    />
                    <FormSubmitButton
                      size="sm"
                      variant="destructive"
                      className="w-full sm:w-auto"
                      loadingText="删除中..."
                    >
                      删除
                    </FormSubmitButton>
                  </TransitionActionForm>
                </div>
              ))
            ) : (
              <div className="rounded-xl border p-3 text-sm text-muted-foreground">
                暂无未执行定时状态。
              </div>
            )}
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              已执行（{executedTransitions.length}）
            </summary>
            <div className="mt-3 space-y-2">
              {executedTransitions.length > 0 ? (
                executedTransitions.map((transition) => (
                  <div
                    key={transition.id}
                    className="rounded-xl border p-3 text-sm text-muted-foreground"
                  >
                    {statusLabel[transition.target_status]} · 计划{" "}
                    {formatDateTime(transition.run_at)} · 执行{" "}
                    {formatDateTime(transition.executed_at)}
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">
                  暂无已执行记录。
                </div>
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle>继承候选项</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          {contest.group_id && groupContests.length > 1 ? (
            <InheritCandidatesForm
              contests={groupContests}
              candidates={groupCandidates}
              defaultTargetContestId={contest.id}
              returnTo={`/admin/contests/${contest.id}/edit`}
            />
          ) : (
            <div className="rounded-2xl border p-5 text-sm text-muted-foreground">
              将活动加入拥有其他活动的活动组后，可以从组内继承候选项。
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
