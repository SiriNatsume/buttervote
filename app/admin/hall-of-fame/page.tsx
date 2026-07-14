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
  const [{ data: entries }, { data: contests }] = await Promise.all([
    supabase
      .from("hall_of_fame_entries")
      .select("id,contest_id,event_title,winner_name,description,poster_path,poster_size")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("contests")
      .select("id,title")
      .order("created_at", { ascending: false }),
  ]);

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
        <CardHeader><CardTitle>Gallery 条目</CardTitle></CardHeader>
        <CardContent>
          <HallOfFameAdmin
            entries={(entries ?? []).flatMap((entry) => {
              const posterUrl = getHallOfFamePosterUrl(entry.poster_path);
              return posterUrl ? [{
                id: entry.id,
                contestId: entry.contest_id,
                eventTitle: entry.event_title,
                winnerName: entry.winner_name,
                description: entry.description,
                posterUrl,
                posterSize: entry.poster_size,
              }] : [];
            })}
            contests={(contests ?? []).map((contest) => ({ id: contest.id, title: contest.title }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
