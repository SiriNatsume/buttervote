"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useTransitionActionFormPending } from "@/components/transition-action-form";
import { cn } from "@/lib/utils";

export function FormStatusFieldset({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const transitionPending = useTransitionActionFormPending();

  return (
    <fieldset
      disabled={pending || transitionPending}
      className={cn("disabled:pointer-events-none disabled:opacity-70", className)}
    >
      {children}
    </fieldset>
  );
}
