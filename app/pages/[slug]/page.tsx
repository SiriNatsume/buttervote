import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { PageTableOfContents } from "@/components/page-table-of-contents";
import { getCurrentProfile } from "@/lib/auth";
import { extractMarkdownHeadings } from "@/lib/markdown-headings";
import { pageVisibilityLabel } from "@/lib/site-pages";
import { createClient } from "@/lib/supabase/server";
import { createRequiredServiceClient } from "@/lib/supabase/service";

const loadPage = cache(async (slug: string) => {
  const profile = await getCurrentProfile();
  // SECURITY CRITICAL: only a profile already verified as an administrator
  // may bypass page RLS to read admin-only content.
  const supabase =
    profile?.role === "admin"
      ? createRequiredServiceClient()
      : await createClient();
  const { data, error } = await supabase
    .from("site_pages")
    .select(
      "id,title,description,slug,content_markdown,visibility,published_at,updated_at",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) console.error(`[site-pages] public lookup failed: ${error.message}`);
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPage(slug);
  if (!page) return {};
  return {
    title: `${page.title} | Butter Vote`,
    description: page.description || undefined,
    robots: page.visibility === "public" ? undefined : { index: false, follow: false },
  };
}

export default async function SitePageRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await loadPage(slug);
  if (!page) notFound();
  const headings = extractMarkdownHeadings(page.content_markdown);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <div
        className={
          headings.length > 0
            ? "lg:grid lg:grid-cols-[12rem_minmax(0,56rem)] lg:justify-center lg:gap-10"
            : "mx-auto max-w-4xl"
        }
      >
        {headings.length > 0 ? (
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <PageTableOfContents headings={headings} />
            </div>
          </aside>
        ) : null}
        <article className="min-w-0">
          <header className="mb-8 border-b border-[#E8DCC3] pb-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {page.visibility === "admin_only" ? (
                <Badge variant="outline">{pageVisibilityLabel[page.visibility]}</Badge>
              ) : null}
            </div>
            <h1 className="text-3xl font-semibold leading-tight text-[#4A2B1B] sm:text-4xl">
              {page.title}
            </h1>
            {page.description ? (
              <p className="mt-4 text-base leading-7 text-muted-foreground">
                {page.description}
              </p>
            ) : null}
          </header>
          <MarkdownRenderer source={page.content_markdown} />
        </article>
      </div>
    </div>
  );
}
