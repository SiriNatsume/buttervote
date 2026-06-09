import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ShieldOff } from "lucide-react";
import {
  renewUserGroupMember,
  revokeUserGroupMember,
} from "@/lib/actions/user-group-actions";
import { requireAdmin } from "@/lib/auth";
import { getUserGroupMembershipStatus } from "@/lib/permissions/user-groups";
import { DeleteUserGroupDialog } from "@/components/delete-user-group-dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { formatDateTime } from "@/lib/time";

function statusMeta(status: ReturnType<typeof getUserGroupMembershipStatus>) {
  if (status === "active") {
    return { label: "有效", variant: "secondary" as const };
  }

  if (status === "revoked") {
    return { label: "已撤销", variant: "destructive" as const };
  }

  return { label: "已过期", variant: "outline" as const };
}

export default async function AdminUserGroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createServerDataClient();
  const [{ data: userGroup }, { data: memberships }] = await Promise.all([
    supabase
      .from("user_groups")
      .select("id,name,description,join_code,created_at,updated_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("user_group_members")
      .select(
        "id,user_group_id,profile_id,source,joined_at,last_verified_at,expires_at,revoked_at",
      )
      .eq("user_group_id", id)
      .order("joined_at", { ascending: false }),
  ]);

  if (!userGroup) {
    notFound();
  }

  const profileIds = [
    ...new Set((memberships ?? []).map((membership) => membership.profile_id)),
  ];
  const { data: profiles } =
    profileIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id,email,display_name,qq_nickname")
          .in("id", profileIds)
      : { data: [] };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-semibold tracking-normal">
            {userGroup.name}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {userGroup.description || "暂无说明。"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/admin/user-groups">全部用户组</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/user-groups">编辑信息</Link>
          </Button>
          <DeleteUserGroupDialog
            userGroupId={userGroup.id}
            triggerClassName="col-span-2 w-full sm:col-span-1 sm:w-auto"
          />
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>用户组信息</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant="love">{userGroup.join_code || "未设置入组代码"}</Badge>
          <Badge variant="secondary">{(memberships ?? []).length} 名成员</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>成员列表</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          {memberships && memberships.length > 0 ? (
            <>
              <div className="space-y-3 md:hidden">
                {memberships.map((membership) => {
                  const profile = profileById.get(membership.profile_id);
                  const meta = statusMeta(getUserGroupMembershipStatus(membership));

                  return (
                    <div
                      key={membership.id}
                      className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/85 p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="break-words font-semibold">
                            {profile?.display_name || profile?.qq_nickname || "未命名用户"}
                          </h3>
                          <p className="mt-1 break-words text-sm text-muted-foreground">
                            {profile?.qq_nickname || "无 QQ 昵称"} ·{" "}
                            {profile?.email || "无邮箱"}
                          </p>
                        </div>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </div>
                      <dl className="mt-4 grid gap-2 text-sm text-muted-foreground">
                        <div>来源：{membership.source}</div>
                        <div>首次加入：{formatDateTime(membership.joined_at)}</div>
                        <div>
                          最近验证：{formatDateTime(membership.last_verified_at)}
                        </div>
                        <div>有效期至：{formatDateTime(membership.expires_at)}</div>
                      </dl>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <TransitionActionForm
                          action={renewUserGroupMember}
                          successMessage="成员权限已续期"
                        >
                          <input type="hidden" name="memberId" value={membership.id} />
                          <FormSubmitButton
                            size="sm"
                            variant="outline"
                            className="w-full"
                            loadingText="续期中..."
                          >
                            <CalendarClock className="size-4" />
                            续期
                          </FormSubmitButton>
                        </TransitionActionForm>
                        <TransitionActionForm
                          action={revokeUserGroupMember}
                          successMessage="成员权限已撤销"
                        >
                          <input type="hidden" name="memberId" value={membership.id} />
                          <FormSubmitButton
                            size="sm"
                            variant="destructive"
                            className="w-full"
                            disabled={Boolean(membership.revoked_at)}
                            loadingText="撤销中..."
                          >
                            <ShieldOff className="size-4" />
                            撤销
                          </FormSubmitButton>
                        </TransitionActionForm>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden rounded-2xl border border-[#EED8AA]/70 md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用户</TableHead>
                      <TableHead>QQ 昵称</TableHead>
                      <TableHead>邮箱</TableHead>
                      <TableHead>来源</TableHead>
                      <TableHead>首次加入</TableHead>
                      <TableHead>最近验证</TableHead>
                      <TableHead>过期时间</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memberships.map((membership) => {
                      const profile = profileById.get(membership.profile_id);
                      const meta = statusMeta(
                        getUserGroupMembershipStatus(membership),
                      );

                      return (
                        <TableRow key={membership.id}>
                          <TableCell className="font-medium">
                            {profile?.display_name || "未命名用户"}
                          </TableCell>
                          <TableCell>{profile?.qq_nickname || "无"}</TableCell>
                          <TableCell>{profile?.email || "无"}</TableCell>
                          <TableCell>{membership.source}</TableCell>
                          <TableCell>{formatDateTime(membership.joined_at)}</TableCell>
                          <TableCell>
                            {formatDateTime(membership.last_verified_at)}
                          </TableCell>
                          <TableCell>{formatDateTime(membership.expires_at)}</TableCell>
                          <TableCell>
                            <Badge variant={meta.variant}>{meta.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap justify-end gap-2">
                              <TransitionActionForm
                                action={renewUserGroupMember}
                                successMessage="成员权限已续期"
                              >
                                <input
                                  type="hidden"
                                  name="memberId"
                                  value={membership.id}
                                />
                                <FormSubmitButton
                                  size="sm"
                                  variant="outline"
                                  loadingText="续期中..."
                                >
                                  续期
                                </FormSubmitButton>
                              </TransitionActionForm>
                              <TransitionActionForm
                                action={revokeUserGroupMember}
                                successMessage="成员权限已撤销"
                              >
                                <input
                                  type="hidden"
                                  name="memberId"
                                  value={membership.id}
                                />
                                <FormSubmitButton
                                  size="sm"
                                  variant="destructive"
                                  disabled={Boolean(membership.revoked_at)}
                                  loadingText="撤销中..."
                                >
                                  撤销
                                </FormSubmitButton>
                              </TransitionActionForm>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/85 p-8 text-muted-foreground">
              该用户组暂无成员。
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
