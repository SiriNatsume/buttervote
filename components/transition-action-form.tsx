"use client";

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useRef,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toUserFacingError } from "@/lib/action-error";

type TransitionActionResult =
  | {
      ok?: boolean;
      error?: string;
      message?: string;
      redirectTo?: string;
      refresh?: boolean;
    }
  | void;

type TransitionAction = (formData: FormData) => Promise<TransitionActionResult>;

const TransitionActionFormPendingContext = createContext(false);

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return toUserFacingError();
  }

  return toUserFacingError(error.message);
}

export function useTransitionActionFormPending() {
  return useContext(TransitionActionFormPendingContext);
}

export function TransitionActionForm({
  action,
  children,
  className,
  onSuccess,
  successMessage = "保存成功",
  refresh = true,
  resetOnSuccess = false,
}: {
  action: TransitionAction;
  children: ReactNode;
  className?: string;
  onSuccess?: (result: TransitionActionResult) => void;
  successMessage?: string;
  refresh?: boolean;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) {
      return;
    }
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const result = await action(formData);

        if (result?.ok === false) {
          toast.error(toUserFacingError(result.error));
          return;
        }

        toast.success(result?.message ?? successMessage);

        if (resetOnSuccess) {
          formRef.current?.reset();
        }

        onSuccess?.(result);

        if (result?.redirectTo) {
          router.push(result.redirectTo);
          router.refresh();
          return;
        }

        if (refresh && result?.refresh !== false) {
          router.refresh();
        }
      } catch (error) {
        if (isNextRedirect(error)) {
          toast.error("登录状态或网络连接不稳定，请稍后再试。");
          return;
        }

        toast.error(errorMessage(error));
      }
    });
  }

  return (
    <TransitionActionFormPendingContext.Provider value={isPending}>
      <form ref={formRef} className={className} onSubmit={handleSubmit}>
        {children}
      </form>
    </TransitionActionFormPendingContext.Provider>
  );
}
