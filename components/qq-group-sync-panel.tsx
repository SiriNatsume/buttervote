"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestQQGroupSync, removeQQGroupRosterMembers } from "@/lib/actions/qq-group-sync-actions";
import { TransitionActionForm } from "@/components/transition-action-form";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/time";
import type { QQGroupSyncConfig, QQGroupSyncJob, QQGroupRosterMember } from "@/lib/types";

function RemoveMatchesDialog({ userGroupId, ids = [], all = false, count, label, disabled, onSuccess }: {
  userGroupId: string; ids?: string[]; all?: boolean; count: number; label: string;
  disabled?: boolean; onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button type="button" variant="destructive" size="sm" disabled={disabled}>{label}</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{all ? "移除全部匹配条目？" : `移除 ${count} 个匹配条目？`}</DialogTitle>
        <DialogDescription>
          {all ? `将移除此用户组全部 ${count} 个匹配条目，包含其他分页。` : "将移除所选 QQ 号与此用户组的匹配关系。"}
          对应账号由名单授予的资格将失效，已有投票记录保留。后续同步不会自动恢复这些条目。
        </DialogDescription>
      </DialogHeader>
      <TransitionActionForm action={removeQQGroupRosterMembers} onSuccess={() => { setOpen(false); onSuccess(); }}>
        <input type="hidden" name="userGroupId" value={userGroupId} />
        <input type="hidden" name="mode" value={all ? "all" : "selected"} />
        {ids.map((id) => <input key={id} type="hidden" name="qqUserId" value={id} />)}
        <FormStatusFieldset className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <DialogClose asChild><Button type="button" variant="outline">取消</Button></DialogClose>
          <FormSubmitButton variant="destructive" loadingText="移除中…">确认移除</FormSubmitButton>
        </FormStatusFieldset>
      </TransitionActionForm>
    </DialogContent>
  </Dialog>;
}

export function QQGroupSyncPanel({ userGroupId, ...initial }: {
  userGroupId: string; config: QQGroupSyncConfig | null; job: QQGroupSyncJob | null;
  members: QQGroupRosterMember[]; page: number; totalPages: number;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const router = useRouter();
  const lastCompletedJob = useRef(initial.job?.status === "succeeded" ? initial.job.id : null);
  const { config, job, members, page, totalPages } = snapshot;
  useEffect(() => {
    if (job?.status === "succeeded" && lastCompletedJob.current !== job.id) {
      lastCompletedJob.current = job.id;
      router.refresh();
    }
  }, [job?.id, job?.status, router]);
  const [readError, setReadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    setSnapshot({ config: initial.config, job: initial.job, members: initial.members, page: initial.page, totalPages: initial.totalPages });
    setReadError(null);
  }, [initial.config, initial.job, initial.members, initial.page, initial.totalPages]);
  useEffect(() => () => requestRef.current?.abort(), []);
  const refreshSnapshot = useCallback(async (force = false) => {
    if (requestRef.current && !force) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    let timedOut = false;
    let failureMessage = "读取匹配名单失败，已保留当前显示，请点击刷新名单重试。";
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    setRefreshing(true);
    try {
      const response = await fetch(`/api/admin/user-groups/${userGroupId}/qq-group-sync?rosterPage=${page}`, {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 403) failureMessage = "登录状态已失效或无管理权限，请重新登录后刷新名单。";
        throw new Error("snapshot_unavailable");
      }
      const next = await response.json() as typeof initial;
      if (!Array.isArray(next.members) || !Number.isSafeInteger(next.page) || !Number.isSafeInteger(next.totalPages)) {
        throw new Error("invalid_snapshot");
      }
      if (!controller.signal.aborted) { setSnapshot(next); setReadError(null); }
    } catch {
      if (!controller.signal.aborted || timedOut) setReadError(failureMessage);
    } finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!controller.signal.aborted || timedOut) setRefreshing(false);
      }
    }
  }, [userGroupId, page]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedIds = members.filter((member) => selected.has(member.qq_user_id)).map((member) => member.qq_user_id);
  const allSelected = members.length > 0 && selectedIds.length === members.length;
  const clearSelection = () => { setSelected(new Set()); void refreshSnapshot(true); };
  const active = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { void refreshSnapshot(); }, 5000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshSnapshot();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [active, refreshSnapshot]);
  const status = { queued: "等待 Bot 同步", running: "正在读取群成员", succeeded: "同步成功", failed: "同步失败" };
  return (
    <Card className="mb-6">
      <CardHeader><CardTitle>从 QQ 群同步成员</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <TransitionActionForm action={requestQQGroupSync} onSuccess={() => { void refreshSnapshot(true); }}>
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
        <p className="text-sm text-muted-foreground">匹配名单中的成员验证对应的 QQ 邮箱后，获得长期有效的用户组资格。名单和资格由管理员移除，后续同步不会因成员退群而自动撤销。</p>
        {job ? <p role="status" className="text-sm">{status[job.status]}{job.error ? `：${job.error}` : ""}</p> : null}
        {active ? <p className="text-sm text-muted-foreground">请确保 Bot 端同步程序正在运行，本页会自动更新。</p> : null}
        {readError ? <p role="alert" className="text-sm text-destructive">{readError}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">最近同步时间：{formatDateTime(config?.last_synced_at)} · 匹配名单 {config?.member_count ?? 0} 人</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={() => { void refreshSnapshot(true); }}>{refreshing ? "读取中…" : "刷新名单"}</Button>
            <RemoveMatchesDialog userGroupId={userGroupId} ids={selectedIds} count={selectedIds.length}
              label={`移除所选（${selectedIds.length}）`} disabled={selectedIds.length === 0} onSuccess={clearSelection} />
            <RemoveMatchesDialog userGroupId={userGroupId} all count={config?.member_count ?? 0}
              label="移除全部匹配" disabled={!config?.member_count} onSuccess={clearSelection} />
          </div>
        </div>
        {members.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40"><tr>
                <th className="w-12 p-3"><Checkbox aria-label="全选本页匹配条目" checked={allSelected ? true : selectedIds.length ? "indeterminate" : false}
                  onCheckedChange={(checked) => setSelected(checked === true ? new Set(members.map((m) => m.qq_user_id)) : new Set())} /></th>
                <th className="whitespace-nowrap p-3">QQ 号</th><th className="p-3">昵称</th><th className="p-3">群名片</th><th className="p-3 text-right">操作</th>
              </tr></thead>
              <tbody>{members.map((member) => <tr key={member.qq_user_id} className="border-t">
                <td className="p-3"><Checkbox aria-label={`选择 QQ ${member.qq_user_id}`} checked={selected.has(member.qq_user_id)}
                  onCheckedChange={(checked) => setSelected((previous) => {
                    const next = new Set(previous);
                    if (checked === true) next.add(member.qq_user_id); else next.delete(member.qq_user_id);
                    return next;
                  })} /></td>
                <td className="p-3">{member.qq_user_id}</td><td className="max-w-48 break-words p-3">{member.nickname || "—"}</td><td className="max-w-48 break-words p-3">{member.card || "—"}</td>
                <td className="p-3 text-right"><RemoveMatchesDialog userGroupId={userGroupId} ids={[member.qq_user_id]}
                  count={1} label="移除" onSuccess={clearSelection} /></td>
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
