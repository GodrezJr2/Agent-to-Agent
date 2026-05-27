import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("DefaultExecutor json_schema fallback", () => {
  it("converts openai-compatible json_schema to json_object and injects schema instructions", () => {
    const executor = new DefaultExecutor("openai-compatible-local");
    const body = {
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Return an answer." },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          schema: {
            type: "object",
            properties: {
              answer: { type: "string" },
            },
            required: ["answer"],
          },
        },
      },
    };

    const result = executor.transformRequest("custom-model", body, true, {});

    expect(result.response_format).toEqual({ type: "json_object" });
    expect(result.messages).not.toBe(body.messages);
    expect(result.messages[0].content).toContain("Be terse.");
    expect(result.messages[0].content).toContain("You must respond with valid JSON");
    expect(result.messages[0].content).toContain('"answer"');
    expect(body.response_format.type).toBe("json_schema");
  });
});
