import { describe, it, expect } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

describe("CodexExecutor request normalization", () => {
  it("sanitizes Responses API body for store=false Codex requests", () => {
    const executor = new CodexExecutor();
    const body = {
      input: [
        { type: "message", role: "system", id: "msg_system", content: [{ type: "input_text", text: "Use policy." }] },
        "resp_previous",
        { type: "item_reference", id: "rs_previous" },
        { type: "message", role: "assistant", id: "msg_assistant", content: [{ type: "output_text", text: "Assistant output long enough to seed the prompt cache session id." }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Continue." }] },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "shell_exec",
            description: "Run a shell command",
            parameters: { type: "object", properties: { command: { type: "string" } } },
          },
        },
        { type: "web_search_preview" },
        { type: "unsupported_hosted_tool" },
        { function: { name: "invalid_shape" } },
      ],
      tool_choice: { type: "function", name: "missing_tool" },
      prompt_cache_key: "conversation-123",
      previous_response_id: "resp_previous",
      metadata: { project: "local" },
      temperature: 0.1,
      unknown_field: true,
    };

    const result = executor.transformRequest("gpt-5.3-codex", body, true, {});

    expect(result.input[0].role).toBe("developer");
    expect(result.input.some((item) => item === "resp_previous" || item?.type === "item_reference")).toBe(false);
    expect(result.input.find((item) => item.role === "assistant")).not.toHaveProperty("id");
    expect(result.tools).toEqual([
      {
        type: "function",
        name: "shell_exec",
        description: "Run a shell command",
        parameters: { type: "object", properties: { command: { type: "string" } } },
      },
      { type: "web_search_preview" },
    ]);
    expect(result).not.toHaveProperty("tool_choice");
    expect(result).not.toHaveProperty("previous_response_id");
    expect(result).not.toHaveProperty("metadata");
    expect(result).not.toHaveProperty("temperature");
    expect(result).not.toHaveProperty("unknown_field");
    expect(result.prompt_cache_key).toBe("conversation-123");
  });

  it("uses prompt cache session and workspace headers", () => {
    const executor = new CodexExecutor();
    const credentials = {
      accessToken: "token",
      providerSpecificData: { workspaceId: "workspace-abc" },
    };

    executor.transformRequest("gpt-5.3-codex", { input: "hello", prompt_cache_key: "conversation-abc" }, true, credentials);
    const headers = executor.buildHeaders(credentials, true);

    expect(headers.session_id).toBe("conversation-abc");
    // Matches the real Codex CLI wire value (also used by the usage service and registry).
    expect(headers.originator).toBe("codex_cli_rs");
    expect(headers["ChatGPT-Account-ID"]).toBe("workspace-abc");
  });
});
