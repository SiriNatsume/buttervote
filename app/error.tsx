"use client";

import { Button } from "@/components/ui/button";
import { MascotEmptyState } from "@/components/mascot";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-3xl items-center px-4 py-12 sm:px-6">
      <MascotEmptyState
        kind="errorState"
        title="页面暂时开小差了"
        actions={<Button onClick={reset}>重试</Button>}
      >
        请稍后再试，或返回上一页重新打开。
      </MascotEmptyState>
    </div>
  );
}
