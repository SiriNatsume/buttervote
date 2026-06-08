"use client";

import { useFormStatus } from "react-dom";
import { useTransitionActionFormPending } from "@/components/transition-action-form";
import {
  LoadingButton,
  type LoadingButtonProps,
} from "@/components/loading-button";

type FormSubmitButtonProps = Omit<LoadingButtonProps, "loading"> & {
  loadingText?: string;
};

export function FormSubmitButton({
  disabled,
  loadingText = "提交中...",
  ...props
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus();
  const transitionPending = useTransitionActionFormPending();
  const isPending = pending || transitionPending;

  return (
    <LoadingButton
      {...props}
      type={props.type ?? "submit"}
      disabled={disabled || isPending}
      loading={isPending}
      loadingText={loadingText}
    />
  );
}
