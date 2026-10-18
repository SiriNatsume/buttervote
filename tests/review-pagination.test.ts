import assert from "node:assert/strict";
import test from "node:test";
import { decodeReviewCursor, encodeReviewCursor, reviewCursorFilter } from "../lib/review-pagination";

const row = { created_at: "2026-10-18T00:00:00.123456+00:00", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };

test("review cursors retain timestamp precision and use the id to order equal timestamps", () => {
  assert.deepEqual(decodeReviewCursor(encodeReviewCursor(row)), row);
  assert.equal(reviewCursorFilter(row, false), `created_at.gt.${row.created_at},and(created_at.eq.${row.created_at},id.gt.${row.id})`);
  assert.equal(reviewCursorFilter(row, true), `created_at.lt.${row.created_at},and(created_at.eq.${row.created_at},id.lt.${row.id})`);
});

test("untrusted cursors cannot inject PostgREST filters or trigger unbounded decoding", () => {
  for (const value of [undefined, "", "!", "x".repeat(513), Buffer.from("null").toString("base64url"),
    Buffer.from(JSON.stringify({ ...row, created_at: "2026-10-18T00:00:00Z),status.eq.approved" })).toString("base64url"),
    Buffer.from(JSON.stringify({ ...row, id: "x),status.eq.approved" })).toString("base64url"),
    Buffer.from(JSON.stringify({ ...row, created_at: "2026-99-99T00:00:00Z" })).toString("base64url"),
  ]) assert.equal(decodeReviewCursor(value), null);
  assert.throws(() => reviewCursorFilter({ ...row, id: "x),status.eq.approved" }, false));
});
