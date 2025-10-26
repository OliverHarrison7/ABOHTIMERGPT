import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TimerStore } from "../src/state/timerStore.js";
import { TimerFileStorage } from "../src/state/timerStorage.js";
import { TimerToolset, startTimerInput } from "../src/tools/timerTool.js";

async function createToolset() {
  const dir = await mkdtemp(join(tmpdir(), "timergpt-test-"));
  const filePath = join(dir, "timers.json");
  const storage = new TimerFileStorage(filePath);
  const initialTimers = await storage.load();
  const store = new TimerStore({
    initialTimers,
    onChange: timers => storage.save(timers)
  });
  const toolset = new TimerToolset(store);

  async function cleanup() {
    await rm(dir, { recursive: true, force: true });
  }

  return { toolset, storagePath: filePath, cleanup };
}

test("startTimer persists a running timer", async t => {
  const { toolset, storagePath, cleanup } = await createToolset();
  t.after(cleanup);

  const result = await toolset.startTimer({
    label: "Focus Session",
    duration: { minutes: 1, seconds: 0 }
  });

  assert.equal(result.timer.status, "running");
  const persisted = JSON.parse(await readFile(storagePath, "utf-8"));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].label, "Focus Session");
  assert.equal(persisted[0].status, "running");
});

test("pause and resume update timer status", async t => {
  const { toolset, storagePath, cleanup } = await createToolset();
  t.after(cleanup);

  const { timer } = await toolset.startTimer({
    label: "Break",
    duration: { minutes: 0, seconds: 30 }
  });

  const paused = await toolset.pauseTimer(timer.id);
  assert.equal(paused.timer.status, "paused");

  const resumed = await toolset.resumeTimer(timer.id);
  assert.equal(resumed.timer.status, "running");

  const persisted = JSON.parse(await readFile(storagePath, "utf-8"));
  assert.equal(persisted[0].status, "running");
});

test("handleTick marks expired timers as completed", async t => {
  const { toolset, storagePath, cleanup } = await createToolset();
  t.after(cleanup);

  const { timer } = await toolset.startTimer({
    label: "Sprint",
    duration: { minutes: 0, seconds: 1 }
  });

  const future = new Date(Date.now() + 5000);
  const completed = await toolset.handleTick(future);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].id, timer.id);
  assert.equal(completed[0].status, "completed");

  const persisted = JSON.parse(await readFile(storagePath, "utf-8"));
  assert.equal(persisted[0].status, "completed");
});

test("extendTimer shortens duration to immediate completion", async t => {
  const { toolset, cleanup } = await createToolset();
  t.after(cleanup);

  const { timer } = await toolset.startTimer({
    label: "Adjustable",
    duration: { minutes: 0, seconds: 10 }
  });

  const result = await toolset.extendTimer({
    id: timer.id,
    seconds: -10
  });

  assert.equal(result.timer.status, "completed");
});

test("startTimer validates duration schema", async () => {
  const invalid = startTimerInput.safeParse({
    duration: { minutes: 0, seconds: 0 }
  });
  assert.ok(!invalid.success);
});
