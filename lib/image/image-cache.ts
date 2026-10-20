// Keep transformed public images in the browser/Workers cache briefly. The
// adapter otherwise only adds cache headers to immutable build-time assets.
export function cacheVoteImageResponse(requestUrl: string, response: Response, storageOrigin: string) {
  const request = new URL(requestUrl);
  if (request.pathname !== "/_next/image" || !response.ok || response.headers.has("Set-Cookie")) return response;
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  if (/\b(private|no-store|immutable)\b/i.test(cacheControl)) return response;

  const source = request.searchParams.get("url");
  if (!source) return response;
  try {
    const image = new URL(source);
    if (image.origin !== new URL(storageOrigin).origin ||
        !image.pathname.startsWith("/storage/v1/object/public/vote-images/")) return response;
  } catch {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=60, s-maxage=60, must-revalidate");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
