/**
 * Unit tests for Codex (OpenAI) refresh token mechanism
 *
 * Verifies that:
 * - Early refresh lead times are configured per provider (synced with CLIProxyAPI)
 * - New refresh_token from response is persisted (token rotation)
 * - Falls back to old refresh_token when server doesn't return new one
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;

describe("Codex Refresh Token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("refreshCodexToken", () => {
    it("should return new refresh_token when server provides one (token rotation)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: "new-access",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
        }),
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("old-refresh-token", null);

      expect(result.refreshToken).toBe("rotated-refresh-token");
      expect(result.accessToken).toBe("new-access");
    });

    it("should keep old refresh_token when server does not return new one", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: "new-access",
          expires_in: 3600,
        }),
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("fallback-refresh-token", null);

      expect(result.refreshToken).toBe("fallback-refresh-token");
    });

    it("deduplicates direct concurrent refreshes and reuses the recent rotated result", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: "dedup-access",
          refresh_token: "dedup-rotated-refresh-token",
          expires_in: 3600,
        }),
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const [first, second] = await Promise.all([
        refreshCodexToken("dedup-refresh-token", null),
        refreshCodexToken("dedup-refresh-token", null),
      ]);
      const third = await refreshCodexToken("dedup-refresh-token", null);

      expect(first).toEqual(second);
      expect(third).toEqual(first);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getAccessToken dedup", () => {
    it("deduplicates concurrent getAccessToken refreshes for non-Codex providers", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: "claude-access",
          refresh_token: "claude-rotated-refresh-token",
          expires_in: 3600,
        }),
      });

      const { getAccessToken } = await import("../../open-sse/services/tokenRefresh.js");
      const [first, second] = await Promise.all([
        getAccessToken("claude", { refreshToken: "claude-refresh-token" }, null),
        getAccessToken("claude", { refreshToken: "claude-refresh-token" }, null),
      ]);
      const third = await getAccessToken("claude", { refreshToken: "claude-refresh-token" }, null);

      expect(first).toEqual(second);
      expect(third).toEqual(first);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getRefreshLeadMs (early refresh config)", () => {
    it("should return provider-specific lead time for OAuth providers", async () => {
      const { getRefreshLeadMs } = await import("../../open-sse/services/tokenRefresh.js");

      // Synced with CLIProxyAPI refresh_registry
      expect(getRefreshLeadMs("codex")).toBe(5 * 24 * 60 * 60 * 1000);   // 5 days
      expect(getRefreshLeadMs("claude")).toBe(4 * 60 * 60 * 1000);       // 4 hours
      expect(getRefreshLeadMs("iflow")).toBe(24 * 60 * 60 * 1000);       // 24 hours
      expect(getRefreshLeadMs("qwen")).toBe(20 * 60 * 1000);             // 20 minutes
      expect(getRefreshLeadMs("kimi-coding")).toBe(5 * 60 * 1000);       // 5 minutes
      expect(getRefreshLeadMs("antigravity")).toBe(5 * 60 * 1000);       // 5 minutes
    });

    it("should fallback to default buffer for unknown providers", async () => {
      const { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import("../../open-sse/services/tokenRefresh.js");

      expect(getRefreshLeadMs("unknown-provider")).toBe(TOKEN_EXPIRY_BUFFER_MS);
      expect(getRefreshLeadMs("openai")).toBe(TOKEN_EXPIRY_BUFFER_MS);
    });

    it("codex lead should be greater than default buffer", async () => {
      const { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import("../../open-sse/services/tokenRefresh.js");

      expect(getRefreshLeadMs("codex")).toBeGreaterThan(TOKEN_EXPIRY_BUFFER_MS);
    });
  });
});
