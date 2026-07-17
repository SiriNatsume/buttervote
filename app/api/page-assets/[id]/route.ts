import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { PAGE_ASSET_BUCKET } from "@/lib/page-assets";
import { createClient } from "@/lib/supabase/server";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function notFoundResponse() {
  return NextResponse.json(
    { error: "附件不存在。" },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const profile = await getCurrentProfile();

  // SECURITY CRITICAL: service role is used for metadata only after an explicit
  // admin check. Everyone else queries through page_assets RLS.
  const metadataClient =
    profile?.role === "admin"
      ? createRequiredServiceClient()
      : await createClient();
  const { data: asset, error } = await metadataClient
    .from("page_assets")
    .select(
      "id,original_filename,extension,mime_type,asset_type,visibility",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) console.error(`[page-assets] read lookup failed: ${error.message}`);
  if (!asset) return notFoundResponse();

  const service = createRequiredServiceClient();
  let internalQuery = service
    .from("page_assets")
    .select("storage_path,visibility")
    .eq("id", asset.id);
  if (profile?.role !== "admin") {
    internalQuery = internalQuery.eq("visibility", "public");
  }
  const { data: internalAsset, error: internalLookupError } =
    await internalQuery.maybeSingle();
  if (internalLookupError || !internalAsset) {
    console.error(
      `[page-assets] internal lookup failed: ${internalLookupError?.message ?? "no row returned"}`,
    );
    return notFoundResponse();
  }

  const forceDownload = new URL(request.url).searchParams.get("download") === "1";
  const shouldDownload =
    forceDownload ||
    (asset.asset_type === "attachment" && asset.extension !== "pdf");
  const { data, error: signedUrlError } = await service.storage
    .from(PAGE_ASSET_BUCKET)
    .createSignedUrl(internalAsset.storage_path, 60, {
      download: shouldDownload ? asset.original_filename : false,
    });

  if (signedUrlError || !data?.signedUrl) {
    console.error(
      `[page-assets] signed URL failed: ${signedUrlError?.message ?? "no URL returned"}`,
    );
    return notFoundResponse();
  }

  const response = NextResponse.redirect(data.signedUrl, 307);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
