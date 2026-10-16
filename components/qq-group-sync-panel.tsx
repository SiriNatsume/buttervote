"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestQQGroupSync } from "@/lib/actions/qq-group-sync-actions";
import { TransitionActionForm } from "@/components/transition-action-form";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/time";
import type { QQGroupSyncConfig, QQGroupSyncJob, QQGroupRosterMember } from "@/lib/types";

export function QQGroupSyncPanel({ userGroupId, config, job, members, page, totalPages }: {
  userGroupId: string; config: QQGroupSyncConfig | null; job: QQGroupSyncJob | null;
  members: QQGroupRosterMember[]; page: number; totalPages: number;
}) {
  const router = useRouter();
  const active = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [active, router]);
  const status = { queued: "等待 Bot 同步", running: "正在读取群成员", succeeded: "同步成功", failed: "同步失败" };
  return (
    <Card className="mb-6">
      <CardHeader><CardTitle>从 QQ 群同步成员</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <TransitionActionForm action={requestQQGroupSync}>
          <FormStatusFieldset className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="userGroupId" value={userGroupId} />
            <div className="space-y-2 sm:flex-1">
              <Label htmlFor="sync-qq-group">QQ 群号</Label>
              <Input id="sync-qq-group" name="qqGroupId" inputMode="numeric" required
                defaultValue={config?.qq_group_id ?? ""} readOnly={Boolean(config)} placeholder="输入 Bot 所在的 QQ 群号" />
            </div>
            <FormSubmitButton loadingText="提交中…" disabled={active}>同步群成员</FormSubmitButton>
          </FormStatusFieldset>
        </TransitionActionForm>
        <p className="text-sm text-muted-foreground">成员验证对应的 QQ 邮箱后，自动获得本用户组资格。未注册成员会保留在名单中。</p>
        {job ? <p role="status" className="text-sm">{status[job.status]}{job.error ? `：${job.error}` : ""}</p> : null}
        {active ? <p className="text-sm text-muted-foreground">请确保 Bot 端同步程序正在运行，本页会自动更新。</p> : null}
        <p className="text-sm text-muted-foreground">最近名单时间：{formatDateTime(config?.last_synced_at)} · {config?.member_count ?? 0} 人</p>
        {members.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40"><tr><th className="p-3">QQ 号</th><th className="p-3">昵称</th><th className="p-3">群名片</th></tr></thead>
              <tbody>{members.map((member) => <tr key={member.qq_user_id} className="border-t">
                <td className="p-3">{member.qq_user_id}</td><td className="max-w-48 break-words p-3">{member.nickname || "—"}</td><td className="max-w-48 break-words p-3">{member.card || "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted-foreground">尚无已同步的群成员。</p>}
        {totalPages > 1 ? <nav className="flex items-center gap-4 text-sm" aria-label="群成员分页">
          {page > 1 ? <a className="underline" href={`?rosterPage=${page - 1}`}>上一页</a> : null}
          <span>第 {page} / {totalPages} 页</span>
          {page < totalPages ? <a className="underline" href={`?rosterPage=${page + 1}`}>下一页</a> : null}
        </nav> : null}
      </CardContent>
    </Card>
  );
}
