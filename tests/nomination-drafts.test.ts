import assert from "node:assert/strict";
import test from "node:test";
import {
  createNominationDraft,
  getNominationDraftError,
  nominationDraftImagePath,
  nominationDraftStorageKey,
  restoreNominationDrafts,
  serializeNominationDrafts,
  type SavedNominationDrafts,
} from "../lib/nomination-drafts";

const userId = "3012ecbd-b471-4b2a-a277-df4a9e6cd2d9";
const contestId = "29558f7d-7482-46f0-b96c-e9de822e853a";

function snapshot(): SavedNominationDrafts {
  const draft = createNominationDraft();
  return {
    version: 1, userId, contestId, nominatorDisplayName: "提名者",
    drafts: [{ ...draft, name: "候选 A", description: "简介", image: {
      imagePath: nominationDraftImagePath(userId, draft.id),
      imageWidth: 768, imageHeight: 768, imageSize: 80000, imageVersion: 1792159200000,
    } }],
  };
}

test("draft recovery preserves candidate IDs, text, shared name and uploaded image metadata", () => {
  const saved = snapshot();
  assert.deepEqual(restoreNominationDrafts(serializeNominationDrafts(saved), userId, contestId), saved);
});

test("drafts are isolated by user and contest, including when a value is stored under the wrong key", () => {
  const raw = serializeNominationDrafts(snapshot());
  assert.equal(restoreNominationDrafts(raw, "another-user", contestId), null);
  assert.equal(restoreNominationDrafts(raw, userId, "another-contest"), null);
  assert.notEqual(nominationDraftStorageKey(userId, contestId), nominationDraftStorageKey("another-user", contestId));
  assert.notEqual(nominationDraftStorageKey(userId, contestId), nominationDraftStorageKey(userId, "another-contest"));
});

test("malformed, incompatible and absent saved drafts fall back without throwing", () => {
  for (const raw of [null, "", "{broken", "null", "[]", '{"version":2}', '{"version":1,"drafts":{}}']) {
    assert.equal(restoreNominationDrafts(raw, userId, contestId), null);
  }
});

test("recovery drops confirmed submissions and duplicate IDs while preserving unsent candidates", () => {
  const saved = snapshot();
  const unsent = { ...createNominationDraft(), name: "候选 B" };
  saved.drafts.push(saved.drafts[0], unsent, unsent);
  const restored = restoreNominationDrafts(JSON.stringify(saved), userId, contestId, new Set([saved.drafts[0].id]));
  assert.deepEqual(restored?.drafts, [unsent]);
});

test("recovery never attaches an image from another account or candidate", () => {
  const saved = snapshot();
  saved.drafts[0].image!.imagePath = nominationDraftImagePath("another-user", saved.drafts[0].id);
  const restored = restoreNominationDrafts(JSON.stringify(saved), userId, contestId);
  assert.equal(restored?.drafts[0].image, null);
  assert.equal(restored?.drafts[0].name, "候选 A");
});

test("empty cards are omitted from storage but text-only and image-only drafts are retained", () => {
  const saved = snapshot();
  const imageOnly = { ...saved.drafts[0], name: "", description: "" };
  const textOnly = { ...createNominationDraft(), description: "稍后填名字" };
  saved.drafts = [createNominationDraft(), imageOnly, textOnly];
  const restored = restoreNominationDrafts(serializeNominationDrafts(saved), userId, contestId);
  assert.deepEqual(restored?.drafts, [imageOnly, textOnly]);
});

test("per-candidate validation respects required images, optional images and description limits", () => {
  const draft = { ...createNominationDraft(), name: "候选", description: "测试简介" };
  assert.equal(getNominationDraftError(draft, false, 4), null);
  assert.match(getNominationDraftError(draft, true, 4)!, /图片/);
  assert.match(getNominationDraftError(draft, false, 3)!, /最多 3 字/);
  assert.match(getNominationDraftError({ ...draft, name: "  " }, false)!, /名称/);
  assert.match(getNominationDraftError({ ...draft, name: "名".repeat(121) }, false)!, /120/);
  assert.equal(getNominationDraftError({ ...draft, description: "😀😀" }, false, 2), null);
});

test("stored snapshots strip transient UI state and never save error or submission metadata", () => {
  const saved = snapshot();
  const withUiState = { ...saved, drafts: [{ ...saved.drafts[0], state: "submitting", expanded: true, error: "temporary" }] };
  const raw = serializeNominationDrafts(withUiState);
  assert.equal(raw.includes("submitting"), false);
  assert.equal(raw.includes("expanded"), false);
  assert.equal(raw.includes("temporary"), false);
});
