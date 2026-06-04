import { describe, it, expect, vi } from "vitest";
import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";

describe("createDisconnectAwareStream", () => {
  it("closes gracefully for abort-style upstream disconnect errors", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const streamController = {
      isConnected: () => true,
      handleComplete: vi.fn(),
      handleError: vi.fn(),
      handleDisconnect: vi.fn(),
    };
    const transformStream = {
      readable: new ReadableStream({
        start(controller) {
          controller.error(abortError);
        },
      }),
      writable: { getWriter: () => ({ abort: () => Promise.resolve() }) },
    };

    const stream = createDisconnectAwareStream(transformStream, streamController);
    const reader = stream.getReader();

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    expect(streamController.handleError).toHaveBeenCalledWith(abortError);
  });
});
