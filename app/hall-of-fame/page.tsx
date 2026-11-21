import type { Metadata } from "next";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { HallOfFameGallery } from "@/components/hall-of-fame-gallery";
import { getHallOfFameJourneyHref, getHallOfFamePosterUrl } from "@/lib/hall-of-fame";
import { fetchRowsByIds } from "@/lib/supabase-pagination";
import { createServerDataClient } from "@/lib/supabase/server-data";

// This page already renders live entries on every request. Declare that before
// the SDK can catch Next's no-store prerender probe as a database error.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "冠军殿堂 | Butter Vote",
  description: "浏览 Butter Vote 历届赛事胜者海报。",
};

export default async function HallOfFamePage() {
  const supabase = await createServerDataClient();
  const { data: entries, error } = await supabase
    .from("hall_of_fame_entries")
    .select(
      "id,contest_group_id,page_id,event_title,winner_name,description,poster_path,thumbnail_path",
    )
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[hall-of-fame] public entries query failed: ${error.message}`);
  }

  // The data client may use a service key (or belong to an administrator).
  // Explicitly exclude private pages before any page metadata reaches the client.
  const pagesResult = await fetchRowsByIds(
    (entries ?? []).flatMap((entry) => entry.page_id ? [entry.page_id] : []),
    (ids) => supabase.from("site_pages")
      .select("id,slug,visibility").in("id", ids).eq("visibility", "public").order("id"),
  );
  if (pagesResult.error) {
    console.error(`[hall-of-fame] journey pages query failed: ${pagesResult.error.message}`);
  }
  const pagesById = new Map((pagesResult.data ?? []).map((page) => [page.id, page]));

  const items = (entries ?? []).flatMap((entry) => {
    const posterUrl = getHallOfFamePosterUrl(entry.poster_path);
    const thumbnailUrl = getHallOfFamePosterUrl(entry.thumbnail_path);
    return posterUrl && thumbnailUrl
      ? [{
          id: entry.id,
          journeyHref: getHallOfFameJourneyHref(entry, pagesById.get(entry.page_id ?? "")),
          eventTitle: entry.event_title,
          winnerName: entry.winner_name,
          description: entry.description,
          posterUrl,
          thumbnailUrl,
        }]
      : [];
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <PageBreadcrumb items={[{ label: "冠军殿堂" }]} section="hall-of-fame" />
      <div className="mb-8 max-w-2xl">
        <p className="text-sm font-medium text-[#B7792C]">历届冠军</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-normal text-[#5C321E] sm:text-5xl">冠军殿堂</h1>
        <p className="mt-4 text-muted-foreground">向历代萌王致敬。</p>
      </div>
      <div className="min-w-0 overflow-hidden">
        <HallOfFameGallery
          items={items}
          errorMessage={error ? "暂时无法读取名人堂内容，请稍后重试。" : null}
        />
      </div>
    </div>
  );
}
