"use client";

import {
  Bold,
  Code2,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Table2,
} from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type EditorCommand =
  | "bold"
  | "italic"
  | "strike"
  | "heading"
  | "quote"
  | "unordered"
  | "ordered"
  | "link"
  | "code"
  | "table";

const commands: Array<{
  command: EditorCommand;
  label: string;
  icon: typeof Bold;
}> = [
  { command: "heading", label: "标题", icon: Heading2 },
  { command: "bold", label: "粗体", icon: Bold },
  { command: "italic", label: "斜体", icon: Italic },
  { command: "strike", label: "删除线", icon: Strikethrough },
  { command: "quote", label: "引用", icon: Quote },
  { command: "unordered", label: "无序列表", icon: List },
  { command: "ordered", label: "有序列表", icon: ListOrdered },
  { command: "link", label: "链接", icon: Link2 },
  { command: "code", label: "代码", icon: Code2 },
  { command: "table", label: "表格", icon: Table2 },
];

function commandText(command: EditorCommand, selected: string) {
  const text = selected || "文本";
  switch (command) {
    case "bold":
      return `**${text}**`;
    case "italic":
      return `*${text}*`;
    case "strike":
      return `~~${text}~~`;
    case "heading":
      return `## ${selected || "标题"}`;
    case "quote":
      return (selected || "引用内容")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "unordered":
      return (selected || "列表项")
        .split("\n")
        .map((line) => `- ${line}`)
        .join("\n");
    case "ordered":
      return (selected || "列表项")
        .split("\n")
        .map((line, index) => `${index + 1}. ${line}`)
        .join("\n");
    case "link":
      return `[${text}](https://)`;
    case "code":
      return selected.includes("\n")
        ? `\`\`\`\n${selected}\n\`\`\``
        : `\`${selected || "code"}\``;
    case "table":
      return "| 标题 1 | 标题 2 |\n| --- | --- |\n| 内容 1 | 内容 2 |";
  }
}

export function MarkdownEditor({
  value,
  onChange,
  onUpload,
  uploading,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onUpload: (file: File) => Promise<string | null>;
  uploading: boolean;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applyCommand(command: EditorCommand) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const replacement = commandText(command, selected);
    onChange(`${value.slice(0, start)}${replacement}${value.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + replacement.length);
    });
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-input", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-input bg-[#FFF8E8] p-2">
        {commands.map(({ command, label, icon: Icon }) => (
          <Button
            key={command}
            type="button"
            size="sm"
            variant="ghost"
            className="size-8 p-0"
            title={label}
            aria-label={label}
            onClick={() => applyCommand(command)}
          >
            <Icon className="size-4" />
          </Button>
        ))}
        <div className="mx-1 h-5 w-px bg-border" />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".jpg,.jpeg,.png,.webp,.pdf,.7z,.rar,.xlsx,.docx,.pptx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              const textarea = textareaRef.current;
              const start = textarea?.selectionStart ?? value.length;
              const end = textarea?.selectionEnd ?? start;
              void onUpload(file).then((markdown) => {
                if (!markdown) return;
                const prefix = value.slice(0, start);
                const suffix = value.slice(end);
                const separator = prefix && !prefix.endsWith("\n") ? "\n" : "";
                const replacement = `${separator}${markdown}`;
                onChange(`${prefix}${replacement}${suffix}`);
                requestAnimationFrame(() => {
                  textarea?.focus();
                  const cursor = prefix.length + replacement.length;
                  textarea?.setSelectionRange(cursor, cursor);
                });
              });
            }
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus className="size-4" />
          {uploading ? "上传中…" : "上传附件"}
        </Button>
      </div>
      <Textarea
        ref={textareaRef}
        value={value}
        disabled={uploading}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[560px] resize-y rounded-none border-0 bg-white/60 font-mono text-sm leading-6 focus-visible:ring-0"
        placeholder="使用 Markdown 编写页面内容……"
        spellCheck={false}
      />
    </div>
  );
}
