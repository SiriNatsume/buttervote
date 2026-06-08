"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { toUserFacingError } from "@/lib/action-error";

const successMessages: Record<string, string> = {
  saved: "保存成功",
  settingsSaved: "保存成功",
  scheduled: "定时状态已更新",
  inherited: "候选项已继承",
  deleted: "删除成功",
  deletedGroup: "活动组已删除，组内活动已变为未分组",
  voted: "投票成功",
  groupVoted: "组内投票提交成功",
  loggedIn: "登录成功",
  registered: "注册成功",
  loggedOut: "已退出登录",
};

function nominationToastKey(pathname: string, nominationId: string) {
  return `butter-vote-nomination-toast:${pathname}:${nominationId}`;
}

export function ToastQueryListener() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    let shouldReplace = false;

    const error = params.get("error");
    if (error) {
      toast.error(toUserFacingError(error));
      params.delete("error");
      shouldReplace = true;
    }

    for (const [key, message] of Object.entries(successMessages)) {
      if (params.has(key)) {
        toast.success(message);
        params.delete(key);
        shouldReplace = true;
      }
    }

    if (params.get("notice") === "email_confirmation_sent") {
      toast.success("验证邮件已发送，请前往邮箱点击验证链接完成注册。");
      params.delete("notice");
      shouldReplace = true;
    }

    const nominationId = params.get("nominationId");
    if (nominationId) {
      const key = nominationToastKey(pathname, nominationId);
      if (sessionStorage.getItem(key) !== "1") {
        toast.success("提名已提交，等待管理员审核");
        sessionStorage.setItem(key, "1");
      }
    }

    if (shouldReplace) {
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      });
    }
  }, [pathname, router, searchParams]);

  return null;
}
