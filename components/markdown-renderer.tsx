import React, {
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import ReactMarkdown, { type UrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { createMarkdownHeadingSlugger } from "@/lib/markdown-headings";
import { cn } from "@/lib/utils";

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-[\w-]+$/],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", /^hljs-[\w-]+$/],
    ],
    input: ["type", "checked", "disabled"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

function isSafeRelativeUrl(value: string) {
  if (value.startsWith("//") || value.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("#")
  );
}

// SECURITY CRITICAL: Markdown links and images must not preserve executable
// protocols such as javascript:, data:, vbscript:, blob:, or file:.
export function sanitizeMarkdownUrl(value: string, key: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return "";
  if (isSafeRelativeUrl(normalized)) return normalized;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return normalized;
    }
    if (key === "href" && parsed.protocol === "mailto:") {
      return normalized;
    }
  } catch {
    return "";
  }

  return "";
}

export const safeMarkdownUrl: UrlTransform = sanitizeMarkdownUrl;

function SafeLink({ href, ...props }: ComponentPropsWithoutRef<"a">) {
  const external = href?.startsWith("http://") || href?.startsWith("https://");
  return (
    <a
      {...props}
      href={href}
      rel={external ? "noopener noreferrer" : undefined}
    />
  );
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactNodeText).join("");
  if (React.isValidElement<{ alt?: string; children?: ReactNode }>(node)) {
    if (node.type === "img") return node.props.alt ?? "";
    return reactNodeText(node.props.children);
  }
  return "";
}

type MarkdownHeadingProps = HTMLAttributes<HTMLHeadingElement> & { node?: unknown };

function createHeadingComponent(
  tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
  slugger: ReturnType<typeof createMarkdownHeadingSlugger>,
) {
  return function MarkdownHeading({ node: _node, children, className, ...props }: MarkdownHeadingProps) {
    return React.createElement(
      tag,
      {
        ...props,
        id: slugger.slug(reactNodeText(children)),
        className: cn("scroll-mt-24", className),
      },
      children,
    );
  };
}

export function MarkdownRenderer({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const headingSlugger = createMarkdownHeadingSlugger();

  return (
    <div className={cn("markdown-content", className)}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
        urlTransform={safeMarkdownUrl}
        components={{
          a: SafeLink,
          h1: createHeadingComponent("h1", headingSlugger),
          h2: createHeadingComponent("h2", headingSlugger),
          h3: createHeadingComponent("h3", headingSlugger),
          h4: createHeadingComponent("h4", headingSlugger),
          h5: createHeadingComponent("h5", headingSlugger),
          h6: createHeadingComponent("h6", headingSlugger),
          img: ({ alt, ...props }) => (
            <img {...props} alt={alt ?? ""} loading="lazy" decoding="async" />
          ),
          input: (props) => <input {...props} disabled />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
