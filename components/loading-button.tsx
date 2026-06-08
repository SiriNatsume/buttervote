"use client";

import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

type LoadingButtonProps = ButtonProps & {
  loading?: boolean;
  loadingText?: string;
};

export function LoadingButton({
  children,
  disabled,
  loading = false,
  loadingText,
  ...props
}: LoadingButtonProps) {
  return (
    <Button aria-busy={loading || undefined} disabled={disabled || loading} {...props}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {loading && loadingText ? loadingText : children}
    </Button>
  );
}

export type { LoadingButtonProps };
