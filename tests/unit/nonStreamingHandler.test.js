import { describe, it, expect } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

describe("translateNonStreamingResponse", () => {
  it("converts OpenAI tool calls to Claude message content for /v1/messages", () => {
    const translated = translateNonStreamingResponse({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 123,
      model: "deepseek-web/expert-deepthink-search",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: {
              name: "Bash",
              arguments: JSON.stringify({ command: "ls", description: "List current directory" }),
            },
          }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
    }, FORMATS.OPENAI, FORMATS.CLAUDE);

    expect(translated).toEqual({
      id: "chatcmpl-1",
      type: "message",
      role: "assistant",
      model: "deepseek-web/expert-deepthink-search",
      content: [{
        type: "tool_use",
        id: "call_1",
        name: "Bash",
        input: { command: "ls", description: "List current directory" },
      }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 11, output_tokens: 3 },
    });
  });
});
