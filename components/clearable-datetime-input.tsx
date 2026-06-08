"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ClearableDatetimeInput({
  id,
  name,
  defaultValue = "",
  required = false,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    const form = inputRef.current?.form;

    if (!form) {
      return;
    }

    function handleReset() {
      setValue(defaultValue);
    }

    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, [defaultValue]);

  return (
    <div className="flex gap-2">
      <Input
        ref={inputRef}
        id={id}
        name={name}
        type="datetime-local"
        required={required}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="清除时间"
        disabled={!value}
        onClick={() => setValue("")}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
