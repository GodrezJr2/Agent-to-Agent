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

  it("prefers the socket-derived real IP set by custom-server", () => {
    const request = {
      headers: new Headers({
        "x-9r-real-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.7, 10.0.0.2",
      }),
    };

    expect(getClientIp(request)).toBe("203.0.113.9");
  });

  it("ignores client-supplied x-forwarded-for when not behind a trusted proxy", () => {
    // XFF is attacker-controlled, so honouring it would let an attacker rotate
    // buckets and escape the limiter. Everything collapses to one bucket instead.
    const request = {
      headers: new Headers({
        "x-forwarded-for": "203.0.113.9, 10.0.0.2",
        "x-real-ip": "198.51.100.7",
      }),
    };

    expect(getClientIp(request)).toBe("unknown");
  });

  it("uses first x-forwarded-for address when TRUST_PROXY is enabled", () => {
    const prev = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "true";
    try {
      const request = {
        headers: new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.2" }),
      };

      expect(getClientIp(request)).toBe("203.0.113.9");
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
    }
  });
});
