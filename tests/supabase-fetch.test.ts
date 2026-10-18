import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseFetch } from "../lib/supabase/fetch";

const requests = new Map<string, number>();
const server = createServer(async (request, response) => {
  const path = new URL(request.url!, "http://localhost").pathname;
  requests.set(path, (requests.get(path) ?? 0) + 1);

  if (path === "/stall-headers") return;
  if (["/stall-body", "/rest/v1/contests", "/rest/v1/rpc/submit_vote"].includes(path)) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write("[");
    return;
  }
  if (path.endsWith("/slow")) {
    const timer = setTimeout(() => response.end("complete"), 200);
    response.on("close", () => clearTimeout(timer));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  response.writeHead(201, { "Content-Type": "application/json", "X-Test-Response": "preserved" });
  response.end(JSON.stringify({ method: request.method, apiKey: request.headers.apikey,
    body: Buffer.concat(chunks).toString() }));
});
let origin: string;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

test("successful requests preserve method, credentials, body, status and response headers", async () => {
  const fetchWithTimeout = createSupabaseFetch({ requestTimeoutMs: 1000 });
  const response = await fetchWithTimeout(`${origin}/echo`, {
    method: "POST", headers: { apikey: "fixture-public-key" }, body: '{"vote":"test"}',
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("X-Test-Response"), "preserved");
  assert.deepEqual(await response.json(), {
    method: "POST", apiKey: "fixture-public-key", body: '{"vote":"test"}',
  });
});

test("a server that never sends headers is aborted", async () => {
  const fetchWithTimeout = createSupabaseFetch({ requestTimeoutMs: 100 });
  await assert.rejects(fetchWithTimeout(`${origin}/stall-headers`), { name: "TimeoutError" });
});

test("the deadline still aborts a response body after headers have arrived", async () => {
  const fetchWithTimeout = createSupabaseFetch({ requestTimeoutMs: 100 });
  const response = await fetchWithTimeout(`${origin}/stall-body`);
  assert.equal(response.status, 200);
  await assert.rejects(response.text(), { name: "TimeoutError" });
});

test("caller cancellation is preserved for both Request and RequestInit signals", async () => {
  const fetchWithTimeout = createSupabaseFetch({ requestTimeoutMs: 1000 });
  const controller = new AbortController();
  const request = new Request(`${origin}/stall-headers`, { signal: controller.signal });
  const pending = fetchWithTimeout(request);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });

  const override = new AbortController();
  const overridden = fetchWithTimeout(new Request(`${origin}/stall-headers`), { signal: override.signal });
  override.abort();
  await assert.rejects(overridden, { name: "AbortError" });

  // Explicit null cancels Request's signal inheritance, as with native fetch.
  const response = await fetchWithTimeout(
    new Request(`${origin}/echo`, { signal: controller.signal }),
    { signal: null },
  );
  assert.equal(response.status, 201);
  await response.json();
});

test("simultaneous requests have independent deadlines and cancellation", async () => {
  const fetchWithTimeout = createSupabaseFetch({ requestTimeoutMs: 100 });
  const [slow, fast] = await Promise.allSettled([
    fetchWithTimeout(`${origin}/stall-headers`),
    fetchWithTimeout(`${origin}/echo`).then((response) => response.json()),
  ]);
  assert.equal(slow.status, "rejected");
  assert.equal(fast.status, "fulfilled");
});

test("storage transfers have a longer deadline than database and auth requests", async () => {
  const fetchWithTimeout = createSupabaseFetch({ requestTimeoutMs: 100, storageTimeoutMs: 1000 });
  const [normal, storage] = await Promise.allSettled([
    fetchWithTimeout(`${origin}/slow`).then((response) => response.text()),
    fetchWithTimeout(new URL(`${origin}/storage/v1/object/slow`)).then((response) => response.text()),
  ]);
  assert.equal(normal.status, "rejected");
  assert.deepEqual(storage, { status: "fulfilled", value: "complete" });
});

test("Supabase returns a query error when the JSON body stalls instead of hanging", async () => {
  const client = createClient(origin, "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createSupabaseFetch({ requestTimeoutMs: 100 }) },
  });
  const result = await client.from("contests").select("id");
  assert.equal(result.status, 0);
  assert.equal(result.data, null);
  assert.ok(result.error);
  assert.match(result.error.message, /abort|timeout/i);
});

test("a timed-out mutation is not automatically submitted again", async () => {
  const client = createClient(origin, "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createSupabaseFetch({ requestTimeoutMs: 100 }) },
  });
  const result = await client.rpc("submit_vote", { candidate: "fixture" });
  assert.equal(result.data, null);
  assert.ok(result.error);
  assert.equal(requests.get("/rest/v1/rpc/submit_vote"), 1);
});
