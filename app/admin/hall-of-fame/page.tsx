import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { HallOfFameAdmin } from "@/components/hall-of-fame-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { getHallOfFamePosterUrl } from "@/lib/hall-of-fame";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export default async function HallOfFameAdminPage() {
  await requireAdmin();
  const supabase = createRequiredServiceClient();
  const [entriesResult, contestsResult] = await Promise.all([
    supabase
      .from("hall_of_fame_entries")
      .select(
        "id,contest_id,event_title,winner_name,description,poster_path,poster_size,thumbnail_path,thumbnail_size",
      )
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("contests")
      .select("id,title")
      .order("created_at", { ascending: false }),
  ]);
  if (entriesResult.error) {
    console.error(
      `[hall-of-fame] admin entries query failed: ${entriesResult.error.message}`,
    );
    throw new Error("冠军英灵殿条目加载失败，请稍后重试。");
  }
  if (contestsResult.error) {
    console.error(
      `[hall-of-fame] contest options query failed: ${contestsResult.error.message}`,
    );
    throw new Error("关联活动列表加载失败，请稍后重试。");
  }

  const entries = entriesResult.data;
  const contests = contestsResult.data;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">冠军英灵殿管理</h1>
          <p className="mt-3 text-muted-foreground">管理历届胜者海报及其公开展示顺序。</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin"><ArrowLeft />返回管理后台</Link>
        </Button>
      </div>
      <Card>
        <CardHeader><CardTitle>展示条目</CardTitle></CardHeader>
        <CardContent>
          <HallOfFameAdmin
            entries={(entries ?? []).flatMap((entry) => {
              const posterUrl = getHallOfFamePosterUrl(entry.poster_path);
              const thumbnailUrl = getHallOfFamePosterUrl(entry.thumbnail_path);
              return posterUrl && thumbnailUrl ? [{
                id: entry.id,
                contestId: entry.contest_id,
                eventTitle: entry.event_title,
                winnerName: entry.winner_name,
                description: entry.description,
                posterUrl,
                posterSize: entry.poster_size,
                thumbnailUrl,
                thumbnailSize: entry.thumbnail_size,
              }] : [];
            })}
            contests={(contests ?? []).map((contest) => ({ id: contest.id, title: contest.title }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
