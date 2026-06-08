import { describe, expect, it } from "vitest";

import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

describe("injectReasoningContent", () => {
  it("echoes reasoning_content placeholder for MiniMax assistant follow-up messages", () => {
    const body = {
      messages: [
        { role: "user", content: "start" },
        { role: "assistant", content: "done" },
      ],
    };

    const result = injectReasoningContent({ provider: "minimax", model: "minimax-m3", body });

    expect(result.messages[1].reasoning_content).toBe(" ");
  });

  it("keeps existing reasoning_content unchanged", () => {
    const body = {
      messages: [
        { role: "assistant", content: "done", reasoning_content: "kept" },
      ],
    };

    const result = injectReasoningContent({ provider: "minimax-cn", model: "MiniMax-M2.7", body });

    expect(result.messages[0].reasoning_content).toBe("kept");
  });
});
