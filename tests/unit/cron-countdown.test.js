import { describe, expect, it } from "vitest";
import { formatCountdown, getJobCountdownLabel, getJobNextRun } from "../../src/lib/cron/countdown.js";

describe("cron countdown helpers", () => {
  const now = new Date("2026-05-15T12:00:00.000Z");

  it("uses nextRun when present", () => {
    const job = { schedule: "6h", createdAt: "2026-05-15T00:00:00.000Z", nextRun: "2026-05-15T15:30:00.000Z", enabled: true };
    expect(getJobNextRun(job, now)?.toISOString()).toBe("2026-05-15T15:30:00.000Z");
  });

  it("falls back to createdAt plus schedule before first run", () => {
    const job = { schedule: "6h", createdAt: "2026-05-15T10:00:00.000Z", nextRun: null, lastRun: null, enabled: true };
    expect(getJobNextRun(job, now)?.toISOString()).toBe("2026-05-15T16:00:00.000Z");
  });

  it("formats live countdown labels", () => {
    const job = { schedule: "6h", createdAt: "2026-05-15T10:00:00.000Z", enabled: true };
    expect(getJobCountdownLabel(job, now)).toBe("in 4h 0m 0s");
    expect(formatCountdown(90_000)).toBe("1m 30s");
  });

  it("shows paused and due states", () => {
    expect(getJobCountdownLabel({ enabled: false, schedule: "6h", createdAt: now.toISOString() }, now)).toBe("paused");
    expect(getJobCountdownLabel({ enabled: true, schedule: "6h", createdAt: "2026-05-15T00:00:00.000Z" }, now)).toBe("due now");
  });
});
