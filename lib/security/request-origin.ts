import "server-only";

// SECURITY CRITICAL: cookie-authenticated mutation routes must reject
// cross-origin requests even if a browser sends the session cookie.
export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const target = new URL(request.url);
    // Next.js may reconstruct request.url using its listener hostname (for
    // example localhost) even when the browser actually requested 127.0.0.1.
    // Host identifies that requested origin; do not trust X-Forwarded-Host.
    const host = request.headers.get("host");
    if (host) {
      if (/[\s/\\@?#]/.test(host)) return false;
      target.host = host;
    }
    return new URL(origin).origin === target.origin;
  } catch {
    return false;
  }
}
