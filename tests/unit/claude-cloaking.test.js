import { describe, expect, it } from "vitest";

import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { CLAUDE_TOOL_SUFFIX } from "../../open-sse/config/appConstants.js";
import { cloakClaudeTools } from "../../open-sse/utils/claudeCloaking.js";

describe("Claude forced tool choice handling", () => {
  it("converts OpenAI function tool_choice to Claude tool_choice", () => {
    const result = openaiToClaudeRequest("claude-sonnet", {
      messages: [{ role: "user", content: "use tool" }],
      tools: [{ type: "function", function: { name: "todo_write", parameters: { type: "object", properties: {} } } }],
      tool_choice: { type: "function", function: { name: "todo_write" } },
    }, false);

    expect(result.tool_choice).toEqual({ type: "tool", name: "todo_write" });
  });

  it("falls back to auto instead of passing unknown Claude tool_choice types through", () => {
    const result = openaiToClaudeRequest("claude-sonnet", {
      messages: [{ role: "user", content: "use tool" }],
      tool_choice: { type: "function", name: "todo_write" },
    }, false);

    expect(result.tool_choice).toEqual({ type: "auto" });
  });

  it("suffixes forced tool_choice only for client tools, not decoy tool names", () => {
    const { body } = cloakClaudeTools({
      tools: [{ name: "todo_write", input_schema: { type: "object", properties: {} } }],
      messages: [],
      tool_choice: { type: "tool", name: "Task" },
    });

    expect(body.tool_choice).toEqual({ type: "tool", name: "Task" });
    expect(body.tools.some(tool => tool.name === `todo_write${CLAUDE_TOOL_SUFFIX}`)).toBe(true);
  });
});
