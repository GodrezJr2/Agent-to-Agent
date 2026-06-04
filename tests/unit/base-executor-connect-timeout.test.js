import { describe, it, expect, vi, afterEach } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../../open-sse/config/runtimeConfig.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";

describe("BaseExecutor fetch connect timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts fetch when upstream does not return response headers", async () => {
    vi.useFakeTimers();
    let capturedSignal;

    vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockImplementation(async (url, init) => {
      capturedSignal = init.signal;
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });

    const executor = new BaseExecutor("test", {
      baseUrl: "https://example.test/v1/chat/completions",
      retry: { 502: { attempts: 0, delayMs: 0 } },
    });

    const pending = executor.execute({
      model: "test-model",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { apiKey: "key" },
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal.aborted).toBe(false);

    const rejection = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(FETCH_CONNECT_TIMEOUT_MS);

    expect(capturedSignal.aborted).toBe(true);
    await rejection;
  });
});
