import Link from "next/link";
import { ShieldCheck, ShieldX } from "lucide-react";
import { requireUser } from "@/lib/auth";
import {
  getUserGroupMemberships,
  getUserGroupMembershipStatus,
} from "@/lib/permissions/user-groups";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateTime } from "@/lib/time";

function membershipStatusMeta(
  status: ReturnType<typeof getUserGroupMembershipStatus>,
) {
  if (status === "active") {
    return { label: "有效", variant: "secondary" as const };
  }

  if (status === "revoked") {
    return { label: "已撤销", variant: "destructive" as const };
  }

  return { label: "已过期", variant: "outline" as const };
}

export default async function MyUserGroupsPage() {
  const user = await requireUser();
  const memberships = await getUserGroupMemberships(user.id);
  const statuses = memberships.map((membership) =>
    getUserGroupMembershipStatus(membership),
  );
  const hasActive = statuses.includes("active");
  const hasExpired = statuses.includes("expired");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">我的用户组</h1>
          <p className="mt-3 text-muted-foreground">
            查看你通过 QQ bot 验证获得的用户组身份。
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">返回首页</Link>
        </Button>
      </div>

      {memberships.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-muted-foreground">
            你当前还没有加入任何用户组。
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-6 space-y-3">
            {hasActive ? (
              <div className="flex items-start gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/85 px-4 py-3 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 text-[#C75F1A]" />
                <span>以下用户组身份仍在有效期内。</span>
              </div>
            ) : null}
            {hasExpired ? (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <ShieldX className="mt-0.5 size-4" />
                <span>部分用户组身份已过期，请通过对应 QQ bot 链接重新验证。</span>
              </div>
            ) : null}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {memberships.map((membership) => {
              const status = getUserGroupMembershipStatus(membership);
              const meta = membershipStatusMeta(status);
              const userGroup = membership.user_group;

              return (
                <Card key={membership.id}>
                  <CardHeader className="p-4 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="break-words">
                          {userGroup?.name || "已删除的用户组"}
                        </CardTitle>
                        {userGroup?.description ? (
                          <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">
                            {userGroup.description}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0 text-sm sm:p-6 sm:pt-0">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">来源：{membership.source}</Badge>
                      {userGroup?.join_code ? (
                        <Badge variant="love">{userGroup.join_code}</Badge>
                      ) : null}
                    </div>
                    <div className="grid gap-2 rounded-2xl border border-[#EED8AA]/70 bg-white/60 p-4 text-muted-foreground">
                      <div>首次加入时间：{formatDateTime(membership.joined_at)}</div>
                      <div>
                        最近验证时间：{formatDateTime(membership.last_verified_at)}
                      </div>
                      <div>有效期至：{formatDateTime(membership.expires_at)}</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
