"use client";

import type * as React from "react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { countCharacters } from "@/lib/description-limit";

type DescriptionTextareaProps = Omit<
  React.ComponentProps<typeof Textarea>,
  "maxLength"
> & {
  maxLength?: number | null;
};

export function DescriptionTextarea({
  maxLength,
  defaultValue,
  value,
  onChange,
  ...props
}: DescriptionTextareaProps) {
  const initialValue =
    typeof defaultValue === "string" || typeof defaultValue === "number"
      ? String(defaultValue)
      : "";
  const [length, setLength] = useState(countCharacters(initialValue));
  const effectiveMaxLength =
    typeof maxLength === "number" && maxLength > 0 ? maxLength : undefined;

  return (
    <div className="space-y-2">
      <Textarea
        {...props}
        value={value}
        defaultValue={defaultValue}
        maxLength={effectiveMaxLength}
        onChange={(event) => {
          setLength(countCharacters(event.currentTarget.value));
          onChange?.(event);
        }}
      />
      {effectiveMaxLength ? (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>最多 {effectiveMaxLength} 字</span>
          <span>
            {value === undefined ? length : countCharacters(String(value ?? ""))} / {effectiveMaxLength}
          </span>
        </div>
      ) : null}
    </div>
  );
}
