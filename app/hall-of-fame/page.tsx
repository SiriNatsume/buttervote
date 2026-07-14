import type { Metadata } from "next";
import { HallOfFameGallery } from "@/components/hall-of-fame-gallery";
import { getHallOfFamePosterUrl } from "@/lib/hall-of-fame";
import { createServerDataClient } from "@/lib/supabase/server-data";

export const metadata: Metadata = {
  title: "冠军英灵殿 | Butter Vote",
  description: "浏览 Butter Vote 历届赛事胜者海报。",
};

export default async function HallOfFamePage() {
  const supabase = await createServerDataClient();
  const { data: entries } = await supabase
    .from("hall_of_fame_entries")
    .select("id,event_title,winner_name,description,poster_path")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const items = (entries ?? []).flatMap((entry) => {
    const posterUrl = getHallOfFamePosterUrl(entry.poster_path);
    return posterUrl
      ? [{
          id: entry.id,
          eventTitle: entry.event_title,
          winnerName: entry.winner_name,
          description: entry.description,
          posterUrl,
        }]
      : [];
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-8 max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-[0.22em] text-[#B7792C]">Hall of Fame</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-normal text-[#5C321E] sm:text-5xl">冠军英灵殿</h1>
        <p className="mt-4 text-muted-foreground">向历代萌王致敬。</p>
      </div>
      <div className="-mx-4 sm:-mx-10 lg:-mx-16 xl:-mx-24">
        <HallOfFameGallery items={items} />
      </div>
    </div>
  );
}
