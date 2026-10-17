import { redirect } from "next/navigation";
import { safeReturnTo } from "@/lib/security/token";
import { qqNumberSchema } from "@/lib/validation/qq-auth";

export default async function RegisterPage({ searchParams }: {
  searchParams: Promise<{ qq?: string; returnTo?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ returnTo: safeReturnTo(params.returnTo) });
  const qq = qqNumberSchema.safeParse(params.qq);
  if (qq.success) query.set("qq", qq.data);
  redirect(`/login?${query}`);
}
