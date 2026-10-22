// Temporary, authenticated read-only probe. No production secrets are copied.
const probe = {
  async fetch(request, env) {
    if (request.method !== "GET" || request.headers.get("Authorization") !== `Bearer ${env.PROBE_TOKEN}`) {
      return new Response("Not found", { status: 404 });
    }
    const paths = JSON.parse(env.PROBE_PATHS);
    const index = Number(new URL(request.url).searchParams.get("case"));
    if (!Number.isInteger(index) || !paths[index]) return new Response("Not found", { status: 404 });
    const started = performance.now();
    // Explicit headers prevent the probe's token or any caller cookies from
    // reaching the application. Both variants invoke the same deployed Worker.
    const response = await env.APP.fetch(new Request(new URL(paths[index], "https://buttervote.com"), {
      headers: { Accept: "text/html" }, redirect: "manual",
    }));
    const ttfbMs = performance.now() - started;
    const html = await response.text();
    const elapsedMs = performance.now() - started;
    const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    const headings = Array.from(withoutScripts.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi),
      (match) => match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).sort();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(headings)));
    return Response.json({
      status: response.status, bytes: new TextEncoder().encode(html).byteLength,
      ttfbMs, elapsedMs, headingHash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ingressColo: request.cf?.colo ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  },
};
export default probe;
