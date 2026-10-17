import Image from "next/image";
import { redirect } from "next/navigation";
import { QQEmailLoginForm } from "@/components/qq-email-login-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth";
import { safeReturnTo } from "@/lib/security/token";
import { qqNumberSchema } from "@/lib/validation/qq-auth";
import logo from "@/img/网站logo.png";

export default async function ForgotPasswordPage({ searchParams }: {
  searchParams: Promise<{ qq?: string; returnTo?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  if (await getCurrentProfile()) redirect(returnTo);
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader className="items-center text-center">
          <Image src={logo} alt="Butter Vote logo" className="h-16 w-auto object-contain" priority />
        </CardHeader>
        <CardContent>
          <QQEmailLoginForm mode="reset" returnTo={returnTo} initialQQ={qqNumberSchema.safeParse(params.qq).data ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
