import { describe, it, expect, vi, afterEach } from "vitest";
import { checkLock, recordFail, recordSuccess, getClientIp } from "../../src/lib/auth/loginLimiter.js";

describe("loginLimiter", () => {
  afterEach(() => {
    recordSuccess("10.0.0.1");
    vi.useRealTimers();
  });

  it("locks an IP after five failed login attempts and resets after success", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T00:00:00Z"));

    for (let i = 0; i < 4; i++) {
      expect(recordFail("10.0.0.1").remainingBeforeLock).toBe(4 - i);
      expect(checkLock("10.0.0.1").locked).toBe(false);
    }

    expect(recordFail("10.0.0.1").remainingBeforeLock).toBe(5);
    expect(checkLock("10.0.0.1")).toEqual({ locked: true, retryAfter: 30 });

    recordSuccess("10.0.0.1");
    expect(checkLock("10.0.0.1").locked).toBe(false);
  });

  it("uses first x-forwarded-for address as client IP", () => {
    const request = {
      headers: new Headers({
        "x-forwarded-for": "203.0.113.9, 10.0.0.2",
        "x-real-ip": "198.51.100.7",
      }),
    };

    expect(getClientIp(request)).toBe("203.0.113.9");
  });
});
