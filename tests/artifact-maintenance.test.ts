import assert from "node:assert/strict";
import test from "node:test";
import { pruneExpiredArtifacts } from "../lib/cache/artifact-maintenance.ts";

test("maintenance deletes only expired owned objects and advances a bounded cursor", async () => {
  const deleted: string[][] = [];
  const writes: string[] = [];
  let listOptions: unknown;
  const count = await pruneExpiredArtifacts({
    get: async () => ({ size: 20, text: async () => '{"cursor":"previous"}' }),
    list: async (options) => {
      listOptions = options;
      return { truncated: true, cursor: "next", objects: [
        { key: "buttervote-artifacts/png/old", customMetadata: { expiresAt: "99" } },
        { key: "buttervote-artifacts/png/fresh", customMetadata: { expiresAt: "101" } },
        { key: "opennext-cache/old", customMetadata: { expiresAt: "1" } },
        { key: "buttervote-artifacts/unknown" },
      ] };
    },
    put: async (_, value) => { writes.push(value); },
    delete: async (keys) => { deleted.push(keys); },
  }, 100);
  assert.equal(count, 1);
  assert.deepEqual(deleted, [["buttervote-artifacts/png/old"]]);
  assert.deepEqual(listOptions, { prefix: "buttervote-artifacts/", limit: 250, cursor: "previous", include: ["customMetadata"] });
  assert.deepEqual(JSON.parse(writes[0]), { cursor: "next" });
});

test("an invalid cursor retries once, and completion restarts the next sweep", async () => {
  let reads = 0;
  let written = "";
  await pruneExpiredArtifacts({
    get: async () => ({ size: 20, text: async () => '{"cursor":"invalid"}' }),
    list: async (options) => { reads += 1; if (options.cursor) throw new Error("invalid cursor"); return { objects: [], truncated: false }; },
    put: async (_, value) => { written = value; }, delete: async () => assert.fail("nothing expired"),
  });
  assert.equal(reads, 2);
  assert.deepEqual(JSON.parse(written), { cursor: null });
});

test("failed deletion cannot advance past expired data", async () => {
  await assert.rejects(pruneExpiredArtifacts({
    get: async () => null,
    list: async () => ({ truncated: true, cursor: "next", objects: [{ key: "buttervote-artifacts/a", customMetadata: { expiresAt: "1" } }] }),
    put: async () => assert.fail("must not advance"), delete: async () => { throw new Error("unavailable"); },
  }, 100), /unavailable/);
});
