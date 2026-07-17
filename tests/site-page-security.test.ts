import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MarkdownRenderer,
  sanitizeMarkdownUrl,
} from "../components/markdown-renderer";
import { extractMarkdownHeadings } from "../lib/markdown-headings";
import {
  PAGE_ASSET_DEFAULT_VISIBILITY,
  defaultPageAssetVisibilityForPage,
} from "../lib/page-assets";
import { validatePageAssetFile } from "../lib/security/page-asset-file-core";
import { sitePageInputSchema } from "../lib/validation/site-page";

test("Markdown URL sanitizer rejects executable and protocol-relative URLs", () => {
  assert.equal(sanitizeMarkdownUrl("javascript:alert(1)", "href"), "");
  assert.equal(sanitizeMarkdownUrl("data:text/html,test", "src"), "");
  assert.equal(sanitizeMarkdownUrl("//evil.example/x", "href"), "");
  assert.equal(sanitizeMarkdownUrl("https://example.com/x", "href"), "https://example.com/x");
  assert.equal(sanitizeMarkdownUrl("/api/page-assets/abc", "src"), "/api/page-assets/abc");
  assert.equal(sanitizeMarkdownUrl("mailto:test@example.com", "href"), "mailto:test@example.com");
  assert.equal(sanitizeMarkdownUrl("mailto:test@example.com", "src"), "");
});

test("Markdown renderer never executes or preserves native HTML", () => {
  const output = renderToStaticMarkup(
    createElement(MarkdownRenderer, {
      source:
        '<script>alert("xss")</script>\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert(2))\n\n| A | B |\n| - | - |\n| 1 | 2 |',
    }),
  );
  assert.equal(output.includes("<script"), false);
  assert.equal(output.includes("onerror"), false);
  assert.equal(output.includes("javascript:"), false);
  assert.equal(output.includes("<table>"), true);
});

test("Markdown table of contents matches rendered heading anchors", () => {
  const source = [
    "# Page title",
    "## 安全规则",
    "### [Attachment rules](/files)",
    "## 安全规则",
    "```md",
    "## Not a heading",
    "```",
  ].join("\n\n");
  const headings = extractMarkdownHeadings(source);

  assert.deepEqual(headings, [
    { depth: 1, id: "page-title", text: "Page title" },
    { depth: 2, id: "安全规则", text: "安全规则" },
    { depth: 3, id: "attachment-rules", text: "Attachment rules" },
    { depth: 2, id: "安全规则-1", text: "安全规则" },
  ]);

  const output = renderToStaticMarkup(createElement(MarkdownRenderer, { source }));
  for (const heading of headings) {
    assert.equal(output.includes(`id="${heading.id}"`), true);
  }
  assert.equal(output.includes('id="not-a-heading"'), false);
});

test("site page validation only accepts normalized ASCII slugs", () => {
  const base = {
    title: "Rules",
    description: "",
    contentMarkdown: "# Rules",
    visibility: "admin_only" as const,
  };
  assert.equal(sitePageInputSchema.safeParse({ ...base, slug: "rules-2026" }).success, true);
  assert.equal(sitePageInputSchema.safeParse({ ...base, slug: "规则" }).success, false);
  assert.equal(sitePageInputSchema.safeParse({ ...base, slug: "rules--2026" }).success, false);
  assert.equal(sitePageInputSchema.safeParse({ ...base, slug: "../rules" }).success, false);
});

test("site page concurrency timestamp accepts Supabase timezone offsets", () => {
  const parsed = sitePageInputSchema.safeParse({
    pageId: "4e8e7f2b-920a-4fb3-840a-59d6b5be4035",
    title: "规则测试",
    description: "Test Rules",
    slug: "tournament-rules",
    contentMarkdown: "略",
    visibility: "public",
    expectedUpdatedAt: "2026-07-16T17:03:49.741632+00:00",
  });

  assert.equal(parsed.success, true);
});

test("page editor attachments inherit the page visibility and fail closed", () => {
  assert.equal(PAGE_ASSET_DEFAULT_VISIBILITY, "admin_only");
  assert.equal(defaultPageAssetVisibilityForPage("admin_only"), "admin_only");
  assert.equal(defaultPageAssetVisibilityForPage("public"), "public");
});

test("page asset validation checks actual file signatures", async () => {
  const pdf = new File([new TextEncoder().encode("%PDF-1.7\n")], "rules.pdf", {
    type: "application/pdf",
  });
  const validPdf = await validatePageAssetFile(pdf);
  assert.equal("error" in validPdf, false);

  const disguisedHtml = new File(
    [new TextEncoder().encode("<script>alert(1)</script>")],
    "attack.pdf",
    { type: "application/pdf" },
  );
  const invalidPdf = await validatePageAssetFile(disguisedHtml);
  assert.equal("error" in invalidPdf, true);
});
