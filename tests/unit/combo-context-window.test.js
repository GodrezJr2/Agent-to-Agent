// combos.contextWindow — operator-set window advertised instead of the smallest seat's.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-cw-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  // Windows keeps the SQLite file locked until the process exits; the OS temp dir cleans up later.
  try {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("combo contextWindow persistence", () => {
  it("is null when never set", async () => {
    const combo = await db.createCombo({ name: "cw-none", models: ["oc/a"] });
    expect(combo.contextWindow).toBeNull();
    expect((await db.getComboByName("cw-none")).contextWindow).toBeNull();
  });

  it("round-trips on create and update, coercing numeric strings", async () => {
    const created = await db.createCombo({ name: "cw-set", models: ["oc/a"], contextWindow: "1000000" });
    expect(created.contextWindow).toBe(1000000);

    const updated = await db.updateCombo(created.id, { contextWindow: 1048576 });
    expect(updated.contextWindow).toBe(1048576);
    expect((await db.getComboById(created.id)).contextWindow).toBe(1048576);
  });

  it("survives an update that does not mention it, and clears on null", async () => {
    const created = await db.createCombo({ name: "cw-keep", models: ["oc/a"], contextWindow: 500000 });
    await db.updateCombo(created.id, { models: ["oc/b"] });
    expect((await db.getComboById(created.id)).contextWindow).toBe(500000);

    await db.updateCombo(created.id, { contextWindow: null });
    expect((await db.getComboById(created.id)).contextWindow).toBeNull();
  });

  it("ignores junk values", async () => {
    const created = await db.createCombo({ name: "cw-junk", models: [] });
    expect((await db.updateCombo(created.id, { contextWindow: "abc" })).contextWindow).toBeNull();
    expect((await db.updateCombo(created.id, { contextWindow: -5 })).contextWindow).toBeNull();
  });
});
