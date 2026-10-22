import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALLING_CHECK_TIMEOUT_MS,
  CALLING_RECONCILE_INTERVAL_MS,
  createCallingRefreshController,
  hasCallingStateChanged,
  isCallingRefreshable,
  type CallingSessionState,
  type ContestCallingRefreshWatch,
} from "../lib/contest-calling-refresh.ts";

const watch: ContestCallingRefreshWatch = {
  contestId: "contest", sessionId: "session", status: "active",
  currentStep: 1, totalSteps: 10, updatedAt: "version-1",
};
const row: CallingSessionState = {
  contest_id: "contest", id: "session", status: "active",
  current_step: 1, total_steps: 10, updated_at: "version-1",
};
const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

test("detects replacements, missing/hidden sessions, rewind, completion, and grouped changes", () => {
  assert.equal(hasCallingStateChanged([watch], [row]), false);
  for (const change of [
    { id: "replacement" }, { status: "paused" as const },
    { status: "completed" as const }, { current_step: 0 },
    { total_steps: 11 }, { updated_at: "version-2" },
  ]) assert.equal(hasCallingStateChanged([watch], [{ ...row, ...change }]), true);
  assert.equal(hasCallingStateChanged([watch], []), true);
  assert.equal(hasCallingStateChanged([watch], [row, { ...row, id: "older" }]), false);
  assert.equal(hasCallingStateChanged([{ ...watch, updatedAt: null }], [row]), false);
  assert.equal(hasCallingStateChanged([watch, { ...watch, contestId: "second" }], [row]), true);
  for (const status of ["draft", "active", "paused"] as const) assert.ok(isCallingRefreshable(status));
  for (const status of ["completed", "archived"] as const) assert.ok(!isCallingRefreshable(status));
});

test("healthy subscriptions reduce idle reads from 40 to 4 per minute", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const controller = createCallingRefreshController({
    getWatches: () => [watch],
    readState: async () => { reads += 1; return [row]; },
    refresh: () => assert.fail("unchanged data must not refresh"),
  });
  t.after(() => controller.dispose());
  controller.setConnected(true);
  controller.setActive(true);
  await settle();
  assert.equal(reads, 1);
  for (let i = 0; i < 4; i += 1) {
    t.mock.timers.tick(CALLING_RECONCILE_INTERVAL_MS);
    await settle();
  }
  assert.equal(reads, 5); // initial read plus four periodic reconciliations
  controller.setConnected(false);
  await settle();
  const beforeFallback = reads;
  t.mock.timers.tick(1499);
  await settle();
  assert.equal(reads, beforeFallback);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(reads, beforeFallback + 1);
});

test("coalesces bursts and queues changes during a router refresh without overlap", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let expected = watch;
  let actual = row;
  let reads = 0;
  let refreshes = 0;
  const controller = createCallingRefreshController({
    getWatches: () => [expected],
    readState: async () => { reads += 1; return [actual]; },
    refresh: () => { refreshes += 1; },
  });
  t.after(() => controller.dispose());
  controller.setActive(true);
  await settle();
  actual = { ...row, current_step: 2 };
  for (let i = 0; i < 20; i += 1) controller.notifyChange();
  t.mock.timers.tick(99);
  await settle();
  assert.equal(reads, 1);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(reads, 2);
  assert.equal(refreshes, 1);
  controller.setRefreshing(true);
  actual = { ...row, current_step: 3 };
  controller.notifyChange();
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(reads, 2);
  assert.equal(refreshes, 1);
  expected = { ...watch, currentStep: 2 };
  controller.setRefreshing(false);
  await settle();
  assert.equal(refreshes, 2); // the event arriving during refresh was retained
  expected = { ...watch, currentStep: 3 };
  controller.setRefreshing(false);
  controller.notifyChange();
  t.mock.timers.tick(100);
  await settle();
  assert.equal(refreshes, 2); // duplicate hints do not refresh an up-to-date page
});

test("compares an in-flight read to the latest server props and catches queued events", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let expected = watch;
  let resolveRead!: (rows: CallingSessionState[]) => void;
  let reads = 0;
  let refreshes = 0;
  const controller = createCallingRefreshController({
    getWatches: () => [expected],
    readState: () => { reads += 1; return new Promise((resolve) => { resolveRead = resolve; }); },
    refresh: () => { refreshes += 1; },
  });
  t.after(() => controller.dispose());
  controller.setActive(true);
  controller.notifyChange();
  controller.checkNow();
  assert.equal(reads, 1);
  expected = { ...watch, currentStep: 2 };
  resolveRead([{ ...row, current_step: 2 }]);
  await settle();
  assert.equal(refreshes, 0);
  t.mock.timers.tick(100);
  await settle();
  assert.equal(reads, 2);
  resolveRead([{ ...row, current_step: 3 }]);
  await settle();
  assert.equal(refreshes, 1);
});

test("suspends hidden/offline work, ignores old responses, and catches up immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending: { signal: AbortSignal; resolve: (rows: CallingSessionState[]) => void }[] = [];
  let refreshes = 0;
  const controller = createCallingRefreshController({
    getWatches: () => [watch],
    readState: (signal) => new Promise((resolve) => { pending.push({ signal, resolve }); }),
    refresh: () => { refreshes += 1; },
  });
  controller.setActive(true);
  controller.setActive(false);
  assert.ok(pending[0].signal.aborted);
  t.mock.timers.tick(60_000);
  controller.notifyChange();
  controller.checkNow();
  assert.equal(pending.length, 1);
  controller.setActive(true);
  assert.equal(pending.length, 2);
  pending[0].resolve([{ ...row, current_step: 2 }]);
  await settle();
  assert.equal(refreshes, 0);
  pending[1].resolve([{ ...row, current_step: 2 }]);
  await settle();
  assert.equal(refreshes, 1);
  controller.dispose();
  t.mock.timers.tick(60_000);
  controller.setActive(true);
  assert.equal(pending.length, 2);
});

test("aborts stalled reads and uses fast polling after a read failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  let signal!: AbortSignal;
  const controller = createCallingRefreshController({
    getWatches: () => [watch],
    readState: (currentSignal) => {
      reads += 1;
      signal = currentSignal;
      if (reads > 1) return Promise.resolve([row]);
      return new Promise((_, reject) => currentSignal.addEventListener("abort", () => reject(new Error("aborted"))));
    },
    refresh: () => assert.fail("no changes"),
  });
  t.after(() => controller.dispose());
  controller.setConnected(true);
  controller.setActive(true);
  t.mock.timers.tick(CALLING_CHECK_TIMEOUT_MS);
  await settle();
  assert.ok(signal.aborted);
  assert.equal(reads, 1);
  t.mock.timers.tick(1500);
  await settle();
  assert.equal(reads, 2);
  t.mock.timers.tick(1500);
  await settle();
  assert.equal(reads, 2); // successful read returns to the healthy heartbeat
});
