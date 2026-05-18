import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildDeepSeekHeaders,
  buildDeepSeekPrompt,
  buildPowHeaderValue,
  detectToolCall,
  mapDeepSeekModel,
  parseDeepSeekSse,
  probeDeepSeekWebToken,
  DeepSeekWebExecutor,
} from "../../open-sse/executors/deepseek-web.js";

const originalFetch = global.fetch;

function sseResponse(text) {
  return new Response(new Blob([text]).stream(), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("mapDeepSeekModel", () => {
  it("maps instant plain model to default without thinking or search", () => {
    expect(mapDeepSeekModel("deepseek-web/instant", {})).toEqual({
      modelType: "default",
      thinkingEnabled: false,
      searchEnabled: false,
    });
  });

  it("maps expert deepthink search model to expert with both flags", () => {
    expect(mapDeepSeekModel("deepseek-web/expert-deepthink-search", {})).toEqual({
      modelType: "expert",
      thinkingEnabled: true,
      searchEnabled: true,
    });
  });

  it("enables thinking from reasoning_effort when model does not explicitly choose deepthink", () => {
    expect(mapDeepSeekModel("deepseek-web/instant", { reasoning_effort: "high" })).toEqual({
      modelType: "default",
      thinkingEnabled: true,
      searchEnabled: false,
    });
  });
});

describe("buildPowHeaderValue", () => {
  it("base64 encodes solved PoW response with target_path", () => {
    const header = buildPowHeaderValue({
      algorithm: "DeepSeekHashV1",
      challenge: "challenge-1",
      salt: "salt-1",
      signature: "sig-1",
      answer: 42,
      target_path: "/api/v0/chat/completion",
    });

    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(decoded).toEqual({
      algorithm: "DeepSeekHashV1",
      challenge: "challenge-1",
      salt: "salt-1",
      answer: 42,
      signature: "sig-1",
      target_path: "/api/v0/chat/completion",
    });
  });
});

describe("buildDeepSeekHeaders", () => {
  it("sends browser-like headers and bearer token", () => {
    const headers = buildDeepSeekHeaders({ apiKey: "tok-1" }, { powHeader: "pow-1" });
    expect(headers.Authorization).toBe("Bearer tok-1");
    expect(headers["x-ds-pow-response"]).toBe("pow-1");
    expect(headers["x-client-platform"]).toBe("web");
    expect(headers["x-client-version"]).toBe("2.0.0");
    expect(headers["User-Agent"]).toContain("Chrome");
  });
});

describe("probeDeepSeekWebToken", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("accepts session create success", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts });
      return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { chat_session: { id: "session-probe" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await expect(probeDeepSeekWebToken("tok-1")).resolves.toEqual({ valid: true, error: null });
    expect(calls).toHaveLength(1);
    expect(calls[0].opts.headers.Authorization).toBe("Bearer tok-1");
  });

  it("rejects expired bearer token", async () => {
    global.fetch = vi.fn(async () => new Response("", { status: 401 }));

    await expect(probeDeepSeekWebToken("bad-token")).resolves.toEqual({
      valid: false,
      error: "DeepSeek auth failed — bearer token may be expired. Re-paste the token from chat.deepseek.com.",
    });
  });
});

describe("buildDeepSeekPrompt", () => {
  it("converts messages and compact tools into one prompt", () => {
    const prompt = buildDeepSeekPrompt({
      messages: [
        { role: "system", content: "Be precise" },
        { role: "user", content: "List files" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "list_files",
            description: "List files in a directory",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        },
      ],
    });

    expect(prompt).toContain("Instructions:\nBe precise");
    expect(prompt).toContain("Current user request:\nList files");
    expect(prompt).toContain("To call a tool, respond with exactly one JSON object");
    expect(prompt).toContain("- list_files(path:string): List files in a directory");
  });
});

describe("parseDeepSeekSse", () => {
  it("separates THINK fragments from RESPONSE fragments and extracts usage", () => {
    const sse = [
      "event: ready",
      "data: {\"request_message_id\":1,\"response_message_id\":2,\"model_type\":\"expert\"}",
      "",
      "data: {\"v\":{\"response\":{\"fragments\":[{\"type\":\"THINK\",\"content\":\"think\"}]}}}",
      "",
      "data: {\"p\":\"response/fragments/-1/content\",\"o\":\"APPEND\",\"v\":\"ing\"}",
      "",
      "data: {\"p\":\"response/fragments\",\"o\":\"APPEND\",\"v\":[{\"type\":\"RESPONSE\",\"content\":\"ans\"}]}",
      "",
      "data: {\"v\":\"wer\"}",
      "",
      "data: {\"p\":\"response\",\"o\":\"BATCH\",\"v\":[{\"p\":\"accumulated_token_usage\",\"v\":9}]}",
      "",
      "event: close",
      "data: {\"click_behavior\":\"none\"}",
      "",
    ].join("\n");

    expect(parseDeepSeekSse(sse)).toEqual({
      content: "answer",
      reasoningContent: "thinking",
      usage: { completion_tokens: 9 },
      requestMessageId: 1,
      responseMessageId: 2,
      modelType: "expert",
    });
  });
});

describe("detectToolCall", () => {
  it("turns single JSON tool response into OpenAI tool call", () => {
    const call = detectToolCall('{"tool":"list_files","args":{"path":"."}}');
    expect(call).toMatchObject({
      type: "function",
      function: { name: "list_files", arguments: JSON.stringify({ path: "." }) },
    });
    expect(call.id).toMatch(/^call_/);
  });

  it("returns null for normal prose", () => {
    expect(detectToolCall("hello world")).toBeNull();
  });
});

describe("DeepSeekWebExecutor.execute", () => {
  let calls;

  beforeEach(() => {
    calls = [];
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.endsWith("/api/v0/chat_session/create")) {
        return new Response(JSON.stringify({
          code: 0,
          data: { biz_code: 0, biz_data: { chat_session: { id: "session-1" } } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/create_pow_challenge")) {
        return new Response(JSON.stringify({
          code: 0,
          data: { biz_code: 0, biz_data: { challenge: {
            algorithm: "DeepSeekHashV1",
            challenge: "challenge-1",
            salt: "salt-1",
            signature: "sig-1",
            difficulty: 3,
            expire_at: 123456,
            expire_after: 300000,
            target_path: "/api/v0/chat/completion",
          } } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/completion")) {
        return sseResponse([
          "event: ready",
          "data: {\"request_message_id\":1,\"response_message_id\":2,\"model_type\":\"default\"}",
          "",
          "data: {\"v\":{\"response\":{\"fragments\":[{\"type\":\"RESPONSE\",\"content\":\"hi\"}]}}}",
          "",
          "data: {\"p\":\"response\",\"o\":\"BATCH\",\"v\":[{\"p\":\"accumulated_token_usage\",\"v\":2}]}",
          "",
          "event: close",
          "data: {}",
          "",
        ].join("\n"));
      }
      return new Response("not found", { status: 404 });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("creates session, solves PoW, and posts DeepSeek completion body", async () => {
    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });
    const { response } = await exec.execute({
      model: "deepseek-web/expert-deepthink-search",
      body: { messages: [{ role: "user", content: "hello" }], stream: false },
      stream: false,
      credentials: { apiKey: "tok-1" },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.choices[0].message.content).toBe("hi");
    const completionCall = calls.find((call) => call.url.endsWith("/api/v0/chat/completion"));
    expect(completionCall.body).toMatchObject({
      chat_session_id: "session-1",
      parent_message_id: null,
      model_type: "expert",
      thinking_enabled: true,
      search_enabled: true,
      ref_file_ids: [],
      preempt: false,
    });
    const powHeader = completionCall.opts.headers["x-ds-pow-response"];
    const decodedPow = JSON.parse(Buffer.from(powHeader, "base64").toString("utf8"));
    expect(decodedPow.answer).toBe(7);
    expect(decodedPow.target_path).toBe("/api/v0/chat/completion");
  });
});
