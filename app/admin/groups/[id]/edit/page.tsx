import Link from "next/link";
import { notFound } from "next/navigation";
import { updateGroupAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { DeleteContestGroupDialog } from "@/components/delete-contest-group-dialog";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { GroupCoverUploader } from "@/components/group-cover-uploader";
import { GroupAccessForm } from "@/components/group-access-form";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default async function EditGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const supabase = await createServerDataClient();
  const [{ data: group }, { data: userGroups }, { data: allowedUserGroups }] =
    await Promise.all([
      supabase
        .from("contest_groups")
        .select(
          "id,name,description,cover_image_path,cover_image_width,cover_image_height,cover_image_size,love_vote_weight,love_vote_quota,access_mode,created_by,created_at,updated_at",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("user_groups")
        .select("id,name,description,join_code")
        .order("created_at", { ascending: false }),
      supabase
        .from("contest_group_allowed_user_groups")
        .select("user_group_id")
        .eq("contest_group_id", id),
    ]);

  if (!group) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">编辑活动组</h1>
          <p className="mt-3 break-words text-muted-foreground">{group.name}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button asChild variant="outline">
            <Link href={`/admin/groups/${group.id}`}>返回活动组</Link>
          </Button>
          <Button asChild>
            <Link href={`/groups/${group.id}`}>打开公开页</Link>
          </Button>
          <DeleteContestGroupDialog
            groupId={group.id}
            triggerClassName="col-span-2 w-full sm:col-span-1 sm:w-auto"
          />
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

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle>基础信息</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <TransitionActionForm
              action={updateGroupAction}
              successMessage="活动组设置已保存"
            >
              <FormStatusFieldset className="space-y-5">
                <input type="hidden" name="groupId" value={group.id} />
                <div className="space-y-2">
                  <Label htmlFor="name">名称</Label>
                  <Input id="name" name="name" required defaultValue={group.name} />
                </div>
              <div className="space-y-2">
                <Label htmlFor="description">简介</Label>
                <Textarea
                  id="description"
                  name="description"
                  defaultValue={group.description ?? ""}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="love_vote_weight">真爱票权重</Label>
                  <Input
                    id="love_vote_weight"
                    name="love_vote_weight"
                    type="number"
                    min="0.1"
                    step="0.1"
                    defaultValue={Number(group.love_vote_weight)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="love_vote_quota">真爱票额度</Label>
                  <Input
                    id="love_vote_quota"
                    name="love_vote_quota"
                    type="number"
                    min="0"
                    defaultValue={group.love_vote_quota}
                    required
                  />
                </div>
              </div>
                <FormSubmitButton className="w-full sm:w-auto" loadingText="保存中...">
                  保存
                </FormSubmitButton>
              </FormStatusFieldset>
            </TransitionActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle>活动组封面</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <GroupCoverUploader
              groupId={group.id}
              value={{
                imagePath: group.cover_image_path,
                imageWidth: group.cover_image_width,
                imageHeight: group.cover_image_height,
                imageSize: group.cover_image_size,
              }}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle>参与权限</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <GroupAccessForm
            groupId={group.id}
            accessMode={group.access_mode ?? "public"}
            userGroups={userGroups ?? []}
            allowedUserGroupIds={(allowedUserGroups ?? []).map(
              (row) => row.user_group_id,
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
