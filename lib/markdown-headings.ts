import remarkParse from "remark-parse";
import { unified } from "unified";

type MarkdownNode = {
  type: string;
  depth?: number;
  value?: string;
  alt?: string;
  children?: MarkdownNode[];
};

export type MarkdownHeading = {
  depth: number;
  id: string;
  text: string;
};

function nodeText(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  if (node.type === "image" && node.alt) return node.alt;
  return node.children?.map(nodeText).join("") ?? "";
}

function headingSlug(text: string) {
  const normalized = text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, "")
    .trim()
    .replace(/[\s_-]+/g, "-");
  return normalized || "section";
}

export function createMarkdownHeadingSlugger() {
  const occurrences = new Map<string, number>();

  return {
    slug(text: string) {
      const base = headingSlug(text);
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      return occurrence === 0 ? base : `${base}-${occurrence}`;
    },
  };
}

export function extractMarkdownHeadings(source: string): MarkdownHeading[] {
  const tree = unified().use(remarkParse).parse(source) as MarkdownNode;
  const slugger = createMarkdownHeadingSlugger();
  const headings: MarkdownHeading[] = [];

  function visit(node: MarkdownNode) {
    if (node.type === "heading" && node.depth) {
      const text = nodeText(node).trim();
      const id = slugger.slug(text);
      // Only headings authored inside Markdown are parsed here. The separate
      // site page title therefore never becomes a table-of-contents entry.
      if (text && node.depth >= 1 && node.depth <= 6) {
        headings.push({ depth: node.depth, id, text });
      }
    }
    node.children?.forEach(visit);
  }

  visit(tree);
  return headings;
}
