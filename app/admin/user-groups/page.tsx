import Link from "next/link";
import { Plus, UsersRound } from "lucide-react";
import { createUserGroup, updateUserGroup } from "@/lib/actions/user-group-actions";
import { requireAdmin } from "@/lib/auth";
import { DeleteUserGroupDialog } from "@/components/delete-user-group-dialog";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
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
import { Textarea } from "@/components/ui/textarea";
import { createServerDataClient } from "@/lib/supabase/server-data";

export default async function AdminUserGroupsPage() {
  await requireAdmin();
  const supabase = await createServerDataClient();
  const [{ data: userGroups }, { data: memberships }] = await Promise.all([
    supabase
      .from("user_groups")
      .select("id,name,description,join_code,created_at,updated_at")
      .order("created_at", { ascending: false }),
    supabase.from("user_group_members").select("user_group_id,expires_at,revoked_at"),
  ]);
  const now = Date.now();
  const memberStats = new Map<string, { total: number; active: number }>();

  for (const membership of memberships ?? []) {
    const current = memberStats.get(membership.user_group_id) ?? {
      total: 0,
      active: 0,
    };
    current.total += 1;

    if (
      !membership.revoked_at &&
      membership.expires_at &&
      new Date(membership.expires_at).getTime() > now
    ) {
      current.active += 1;
    }

    memberStats.set(membership.user_group_id, current);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">用户组</h1>
          <p className="mt-3 text-muted-foreground">
            管理 QQ bot ticket 可续期的网站内用户组。
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin">返回后台</Link>
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-5 text-[#C75F1A]" />
            创建用户组
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <TransitionActionForm
            action={createUserGroup}
            successMessage="用户组已创建"
            resetOnSuccess
          >
            <FormStatusFieldset className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
              <div className="space-y-2">
                <Label htmlFor="new-name">名称</Label>
                <Input id="new-name" name="name" required placeholder="QQ 群 A" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-join-code">入组代码</Label>
                <Input
                  id="new-join-code"
                  name="join_code"
                  placeholder="qq_group_123456"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-description">说明</Label>
                <Input id="new-description" name="description" />
              </div>
              <FormSubmitButton className="w-full" loadingText="创建中...">
                创建
              </FormSubmitButton>
            </FormStatusFieldset>
          </TransitionActionForm>
        </CardContent>
      </Card>

      {userGroups && userGroups.length > 0 ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {userGroups.map((userGroup) => {
            const stats = memberStats.get(userGroup.id) ?? {
              total: 0,
              active: 0,
            };

            return (
              <Card key={userGroup.id}>
                <CardHeader className="p-4 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="break-words">{userGroup.name}</CardTitle>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="secondary">
                          <UsersRound className="mr-1 size-3" />
                          {stats.total} 名成员
                        </Badge>
                        <Badge variant="outline">{stats.active} 名有效</Badge>
                        {userGroup.join_code ? (
                          <Badge variant="love">{userGroup.join_code}</Badge>
                        ) : (
                          <Badge variant="outline">未设置入组代码</Badge>
                        )}
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/user-groups/${userGroup.id}`}>
                        查看成员
                      </Link>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
                  <TransitionActionForm
                    action={updateUserGroup}
                    successMessage="用户组已保存"
                  >
                    <FormStatusFieldset className="space-y-4">
                      <input
                        type="hidden"
                        name="userGroupId"
                        value={userGroup.id}
                      />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor={`name-${userGroup.id}`}>名称</Label>
                          <Input
                            id={`name-${userGroup.id}`}
                            name="name"
                            required
                            defaultValue={userGroup.name}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`join-code-${userGroup.id}`}>
                            入组代码
                          </Label>
                          <Input
                            id={`join-code-${userGroup.id}`}
                            name="join_code"
                            defaultValue={userGroup.join_code ?? ""}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`description-${userGroup.id}`}>说明</Label>
                        <Textarea
                          id={`description-${userGroup.id}`}
                          name="description"
                          defaultValue={userGroup.description ?? ""}
                        />
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <FormSubmitButton
                          className="w-full sm:w-auto"
                          loadingText="保存中..."
                        >
                          保存
                        </FormSubmitButton>
                      </div>
                    </FormStatusFieldset>
                  </TransitionActionForm>
                  <div className="flex justify-end">
                    <DeleteUserGroupDialog
                      userGroupId={userGroup.id}
                      triggerLabel="删除"
                      triggerClassName="w-full sm:w-auto"
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/85 p-8 text-muted-foreground">
          暂无用户组。
        </div>
      )}
    </div>
  );
}
