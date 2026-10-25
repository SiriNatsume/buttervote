import assert from "node:assert/strict";
import test from "node:test";
import { nominationDisplay, nominationImageVersion, type SubmittedNomination } from "../lib/submitted-nomination";

const entry = { id: "id", name: "Old name", description: "Old description", image: null, state: "success" };
const current: SubmittedNomination = {
  id: "id", name: "Admin edit", description: "New description", status: "pending",
  image_path: "candidates/id/image.jpg", updated_at: "2026-10-25T00:00:00Z",
};

test("submitted cards use fresh content for every review state", () => {
  for (const status of ["pending", "approved", "rejected", "draft"] as const) {
    const display = nominationDisplay(entry, { ...current, status });
    assert.equal(display.name, current.name);
    assert.equal(display.description, current.description);
    assert.equal(display.status, status);
    assert.equal(display.imagePath, current.image_path);
    assert.equal(display.imageVersion, Date.parse(current.updated_at));
  }
});

test("refresh does not overwrite an unsent or failed draft", () => {
  for (const state of ["editing", "submitting", "error"]) {
    assert.equal(nominationDisplay({ ...entry, state }, current).name, entry.name);
  }
  assert.equal(nominationDisplay(entry).name, entry.name);
});

test("cleared descriptions and images do not resurrect the submitted snapshot", () => {
  const display = nominationDisplay(entry, { ...current, description: null, image_path: null, updated_at: "invalid" });
  assert.equal(display.description, "");
  assert.equal(display.imagePath, null);
  assert.equal(display.imageVersion, undefined);
});

test("same-path image replacement changes its version without disabling reuse", () => {
  const first = nominationImageVersion(current.updated_at);
  assert.equal(first, nominationImageVersion(current.updated_at));
  assert.notEqual(first, nominationImageVersion("2026-10-25T00:01:00Z"));
  assert.equal(nominationImageVersion(), undefined);
});
