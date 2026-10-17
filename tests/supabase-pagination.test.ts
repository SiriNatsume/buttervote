import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllRows, fetchPageRows, fetchRowsByIds } from "../lib/supabase-pagination";

const rangeError = { data: null, error: { message: "Requested range not satisfiable", code: "PGRST103" }, status: 416 };
const rows = (length: number) => Array.from({ length }, (_, id) => ({ id }));

test("paged reads clamp deleted, oversized, negative, and invalid page numbers before requesting an offset", async () => {
  for (const requested of [99, 1e100, NaN, -1, 0, 1.5]) {
    const calls: number[] = [];
    const result = await fetchPageRows(() => ({ range: async (from, to) => {
      calls.push(from);
      return { data: rows(55).slice(from, to + 1), error: null, count: 55 };
    } }), requested);
    assert.equal(result.error, null);
    if (result.error) continue;
    assert.equal(result.page, requested === 99 ? 2 : 1);
    assert.ok(calls.every((offset) => offset === 0 || offset === 50));
  }
});

test("empty and never-synced lists stay on page one, even when a stale URL asks for another page", async () => {
  const result = await fetchPageRows(() => ({ range: async (from) => {
    assert.equal(from, 0);
    return { data: [], error: null, count: 0 };
  } }), 9);
  assert.deepEqual(result, { data: [], error: null, page: 1, totalPages: 1, totalCount: 0 });
});

test("a list cleared between page requests recovers from the real PostgREST range error", async () => {
  const calls: number[] = [];
  const result = await fetchPageRows(() => ({ range: async (from) => {
    calls.push(from);
    if (calls.length === 1) return { data: rows(50), error: null, count: 120 };
    if (calls.length === 2) return rangeError;
    return { data: [], error: null, count: 0 };
  } }), 3);
  assert.deepEqual(calls, [0, 100, 0]);
  assert.deepEqual(result, { data: [], error: null, page: 1, totalPages: 1, totalCount: 0 });
});

test("a successful but now-empty offset also recovers to a fresh first page", async () => {
  let call = 0;
  const result = await fetchPageRows(() => ({ range: async () => {
    call++;
    if (call === 1) return { data: rows(50), error: null, count: 60 };
    return { data: [], error: null, count: 0 };
  } }), 2);
  assert.equal(call, 3);
  assert.equal(result.error, null);
  if (!result.error) assert.equal(result.page, 1);
});

test("genuine query failures and missing counts are never presented as an empty successful page", async () => {
  const failure = { message: "permission denied", code: "42501" };
  const denied = await fetchPageRows(() => ({ range: async () => ({ data: null, error: failure, status: 403 }) }), 2);
  assert.deepEqual(denied, { data: null, error: failure });
  const missingCount = await fetchPageRows(() => ({ range: async () => ({ data: rows(1), error: null }) }), 1);
  assert.ok(missingCount.error);
});

test("complete list reads exceed 1000 rows and honor a lower server row cap without losing records", async () => {
  const all = rows(1250);
  const offsets: number[] = [];
  const result = await fetchAllRows(() => ({ range: async (from, to) => {
    offsets.push(from);
    return { data: all.slice(from, Math.min(from + 300, to + 1)), error: null };
  } }));
  assert.equal(result.error, null);
  assert.deepEqual(result.data, all);
  assert.deepEqual(offsets, [0, 300, 600, 900, 1200, 1250]);
});

test("exact counts stop at the final row without requesting an invalid extra page", async () => {
  const all = rows(1000);
  let calls = 0;
  const result = await fetchAllRows(() => ({ range: async (from, to) => {
    calls++;
    return { data: all.slice(from, to + 1), count: all.length, error: null };
  } }));
  assert.deepEqual(result.data, all);
  assert.equal(calls, 1);
});

test("complete list reads restart once when deletion invalidates a later offset", async () => {
  let call = 0;
  const result = await fetchAllRows(() => ({ range: async () => {
    call++;
    if (call === 1) return { data: rows(50), error: null };
    if (call === 2) return rangeError;
    return { data: [], count: 0, error: null };
  } }), 50);
  assert.deepEqual(result, { data: [], error: null });
  assert.equal(call, 3);
});

test("an uncounted exact final page cannot cause an endless loop or a false list failure", async () => {
  let calls = 0;
  const result = await fetchAllRows(() => ({ range: async (from) => {
    calls++;
    return from === 0 ? { data: rows(2), error: null } : rangeError;
  } }), 2);
  assert.deepEqual(result, { data: rows(2), error: null });
  assert.equal(calls, 4);
});

test("later network and authorization failures discard partial results", async () => {
  let calls = 0;
  const failure = { message: "connection failed" };
  const result = await fetchAllRows(() => ({ range: async () => {
    calls++;
    return calls === 1 ? { data: rows(2), error: null } : { data: null, error: failure };
  } }), 2);
  assert.deepEqual(result, { data: null, error: failure });
});

test("profile lookups deduplicate and batch IDs so large rosters cannot produce oversized URLs", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => String(i));
  const sizes: number[] = [];
  const result = await fetchRowsByIds([...ids, ...ids], (batch) => {
    sizes.push(batch.length);
    return { range: async () => ({ data: batch.map((id) => ({ id })), count: batch.length, error: null }) };
  });
  assert.equal(result.error, null);
  assert.deepEqual(sizes, [100, 100, 50]);
  assert.equal(result.data?.length, 250);
  assert.deepEqual(await fetchRowsByIds([], () => { throw new Error("must not query empty IDs"); }), { data: [], error: null });
});

test("one failed profile batch prevents a misleading partial member list", async () => {
  let batches = 0;
  const failure = { message: "lookup failed" };
  const result = await fetchRowsByIds(Array.from({ length: 101 }, (_, i) => String(i)), (batch) => ({ range: async () => {
    batches++;
    return batches === 1 ? { data: batch, count: batch.length, error: null } : { data: null, error: failure };
  } }));
  assert.deepEqual(result, { data: null, error: failure });
});
