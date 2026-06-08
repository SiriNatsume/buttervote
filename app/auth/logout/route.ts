import { NextResponse } from "next/server";
import { revokeCurrentAppSession } from "@/lib/auth/app-session";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  await revokeCurrentAppSession();

  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/", request.url));
}
