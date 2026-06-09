import Link from "next/link";
import { HomepageHeroForm } from "@/components/homepage-hero-form";
import { HomepageHeroUploader } from "@/components/homepage-hero-uploader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { createServerDataClient } from "@/lib/supabase/server-data";
import type { HomepageHeroValue } from "@/lib/types";

export default async function AdminHomepagePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireAdmin();
  const query = await searchParams;
  const supabase = await createServerDataClient();
  const [
    { data: groups },
    { data: contests },
    { data: tournaments },
    { data: setting },
  ] =
    await Promise.all([
      supabase
        .from("contest_groups")
        .select("id,name")
        .order("created_at", { ascending: false }),
      supabase
        .from("contests")
        .select("id,title")
        .is("archived_at", null)
        .neq("status", "draft")
        .order("created_at", { ascending: false }),
      supabase
        .from("tournaments")
        .select("id,name")
        .neq("status", "archived")
        .order("created_at", { ascending: false }),
      supabase
        .from("site_settings")
        .select("value")
        .eq("key", "homepage_hero")
        .maybeSingle(),
    ]);
  const heroValue = (setting?.value ?? null) as HomepageHeroValue | null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">首页</h1>
          <p className="mt-3 text-muted-foreground">
            选择首页 Hero 推荐展示的活动、活动组或赛事对阵图。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/admin">返回后台</Link>
          </Button>
        </div>
      </div>

      {query.error ? (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {query.error}
        </div>
      ) : null}

      {query.saved ? (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          已保存。
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle>Hero 内容</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <HomepageHeroForm
              groups={(groups ?? []).map((group) => ({
                id: group.id,
                label: group.name,
              }))}
              contests={(contests ?? []).map((contest) => ({
                id: contest.id,
                label: contest.title,
              }))}
              tournaments={(tournaments ?? []).map((tournament) => ({
                id: tournament.id,
                label: tournament.name,
              }))}
              value={heroValue}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle>Hero 图片</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            <HomepageHeroUploader
              value={{
                imagePath: heroValue?.imagePath ?? null,
                imageWidth: null,
                imageHeight: null,
                imageSize: null,
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
