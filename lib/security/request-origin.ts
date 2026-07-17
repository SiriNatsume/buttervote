import "server-only";

// SECURITY CRITICAL: cookie-authenticated mutation routes must reject
// cross-origin requests even if a browser sends the session cookie.
export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
