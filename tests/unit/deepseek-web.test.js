import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildDeepSeekHeaders,
  buildDeepSeekPrompt,
  buildPowHeaderValue,
  detectToolCall,
  detectToolCalls,
  mapDeepSeekModel,
  parseDeepSeekSse,
  probeDeepSeekWebToken,
  resolveDeepSeekWasmPath,
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
      agentic: false,
    });
  });

  it("maps expert deepthink search model to expert with both flags", () => {
    expect(mapDeepSeekModel("deepseek-web/expert-deepthink-search", {})).toEqual({
      modelType: "expert",
      thinkingEnabled: true,
      searchEnabled: true,
      agentic: false,
    });
  });

  it("enables thinking from reasoning_effort when model does not explicitly choose deepthink", () => {
    expect(mapDeepSeekModel("deepseek-web/instant", { reasoning_effort: "high" })).toEqual({
      modelType: "default",
      thinkingEnabled: true,
      searchEnabled: false,
      agentic: false,
    });
  });
});

describe("resolveDeepSeekWasmPath", () => {
  it("resolves URL-like wasm module references after string coercion", () => {
    const urlLike = {
      toString() {
        return new URL("../../open-sse/executors/deepseek-pow.wasm", import.meta.url).toString();
      },
    };

    expect(resolveDeepSeekWasmPath(urlLike)).toContain("deepseek-pow.wasm");
  });

  it("falls back to cwd open-sse path when module URL is not file-based", () => {
    const resolved = resolveDeepSeekWasmPath("webpack://_N_E/open-sse/executors/deepseek-pow.wasm");

    expect(resolved).toBe(path.join(process.cwd(), "open-sse", "executors", "deepseek-pow.wasm"));
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

  it("includes assistant tool_calls as history entry so DeepSeek has context", () => {
    const prompt = buildDeepSeekPrompt({
      messages: [
        { role: "user", content: "make me a landing page" },
        { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "Skill", arguments: '{"skill":"superpowers:brainstorming"}' } }] },
        { role: "tool", tool_call_id: "call_1", content: "skill loaded" },
      ],
    });

    expect(prompt).toContain("assistant: [called Skill(");
    expect(prompt).toContain("superpowers:brainstorming");
  });

  it("truncates long tool results so context stays manageable", () => {
    const longContent = "x".repeat(2000);
    const prompt = buildDeepSeekPrompt({
      messages: [
        { role: "user", content: "do something" },
        { role: "tool", tool_call_id: "call_1", content: longContent },
      ],
    });

    const toolLine = prompt.split("\n").find((l) => l.startsWith("tool "));
    expect(toolLine).toBeTruthy();
    expect(toolLine.length).toBeLessThan(1200);
    expect(toolLine).toContain("...(truncated)");
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

  it("applies indexed RESPONSE fragment content before append chunks", () => {
    const sse = [
      "data: {\"v\":{\"response\":{\"fragments\":[{\"type\":\"RESPONSE\",\"content\":\"\"}]}}}",
      "",
      "data: {\"p\":\"response/fragments/0/content\",\"o\":\"SET\",\"v\":\"p\"}",
      "",
      "data: {\"p\":\"response/fragments/-1/content\",\"o\":\"APPEND\",\"v\":\"ong\"}",
      "",
    ].join("\n");

    expect(parseDeepSeekSse(sse).content).toBe("pong");
  });

  it("appends last RESPONSE fragment content when DeepSeek omits the operation", () => {
    const sse = [
      "data: {\"p\":\"response/fragments\",\"o\":\"APPEND\",\"v\":[{\"type\":\"RESPONSE\",\"content\":\"p\"}]}",
      "",
      "data: {\"p\":\"response/fragments/-1/content\",\"v\":\"ong\"}",
      "",
    ].join("\n");

    expect(parseDeepSeekSse(sse).content).toBe("pong");
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

  it("turns Claude-style tool_call text into OpenAI tool call", () => {
    const call = detectToolCall('<tool_call name="Bash">\n{"command":"Get-ChildItem -Path \"F:\\\\Project\\\\Deepseek Reverse Engineerr\" -Recurse","description":"List all files in workspace recursively"}\n</tool_call>');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Bash",
        arguments: JSON.stringify({
          command: 'Get-ChildItem -Path "F:\\Project\\Deepseek Reverse Engineerr" -Recurse',
          description: "List all files in workspace recursively",
        }),
      },
    });
    expect(call.id).toMatch(/^call_/);
  });

  it("turns hyphenated Claude-style tool-call text into OpenAI tool call", () => {
    const call = detectToolCall('Directory empty. Creating page.\n\n<tool-call name="Write">\n{"file_path":"F:\\\\Project\\\\Ai AGent\\\\index.html","content":"hello"}\n</tool-call>');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Write",
        arguments: JSON.stringify({
          file_path: "F:\\Project\\Ai AGent\\index.html",
          content: "hello",
        }),
      },
    });
  });

  it("turns unclosed Claude-style tool_call text into OpenAI tool call", () => {
    const call = detectToolCall('tool_call name="Bash">\n{"command":"Get-ChildItem","description":"List files"}');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Bash",
        arguments: JSON.stringify({ command: "Get-ChildItem", description: "List files" }),
      },
    });
  });

  it("turns clipped JSON tool response into OpenAI tool call", () => {
    const call = detectToolCall('tool":"Bash","args":{"command":"ls","description":"List current directory"}}');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Bash",
        arguments: JSON.stringify({ command: "ls", description: "List current directory" }),
      },
    });
  });

  it("turns fenced JSON tool response with arguments into OpenAI tool call", () => {
    const call = detectToolCall('```json\n{\n  "tool": "Bash",\n  "arguments": {\n    "command": "pwd",\n    "description": "Print working directory"\n  }\n}\n```');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Bash",
        arguments: JSON.stringify({ command: "pwd", description: "Print working directory" }),
      },
    });
  });

  it("turns JSON-labeled tool response with trailing fence into OpenAI tool call", () => {
    const call = detectToolCall('json\n{\n  "tool": "Bash",\n  "arguments": {\n    "command": "pwd",\n    "description": "Print current working directory"\n  }\n}\n```');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Bash",
        arguments: JSON.stringify({ command: "pwd", description: "Print current working directory" }),
      },
    });
  });

  it("turns prose with multiple Claude-style tool calls into the first OpenAI tool call", () => {
    const call = detectToolCall(' me read the key files.\n\n<tool_call name="Read">\n{"file_path":"F:\\\\Project\\\\Deepseek Reverse Engineerr\\\\deepseek-module-42587.txt","limit":100}\n</tool_call>\n<tool_call name="Read">\n{"file_path":"F:\\\\Project\\\\Deepseek Reverse Engineerr\\\\pow-wasm.mjs"}\n</tool_call>');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Read",
        arguments: JSON.stringify({
          file_path: "F:\\Project\\Deepseek Reverse Engineerr\\deepseek-module-42587.txt",
          limit: 100,
        }),
      },
    });
  });

  it("turns parameter-style Claude tool calls into OpenAI tool calls", () => {
    const call = detectToolCall('<tool_call name="Read">\n<parameter name="file_path">C:\\Users\\Administrator\\AppData\\Roaming\\npm\\claude-dsw.cmd</parameter>\n<parameter name="limit">2</parameter>\n</tool_call>');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Read",
        arguments: JSON.stringify({
          file_path: "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\claude-dsw.cmd",
          limit: 2,
        }),
      },
    });
  });

  it("turns Claude XML tool tags into OpenAI tool calls", () => {
    const call = detectToolCall('<tool name="Skill">\n<parameter name="skill">superpowers:brainstorming</parameter>\n<parameter name="args">User wants a landing page.</parameter>\n</tool>');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Skill",
        arguments: JSON.stringify({
          skill: "superpowers:brainstorming",
          args: "User wants a landing page.",
        }),
      },
    });
  });

  it("turns clipped flat JSON tool calls into OpenAI tool calls", () => {
    const call = detectToolCall('tool":"Read","file_path":"C:\\\\Users\\\\Administrator\\\\AppData\\\\Roaming\\\\npm\\\\claude-dsw.cmd","limit":2}}');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Read",
        arguments: JSON.stringify({
          file_path: "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\claude-dsw.cmd",
          limit: 2,
        }),
      },
    });
  });

  it("turns DeepSeek file-write blocks into Write tool calls", () => {
    const call = detectToolCall('<file-write>\n<path>C:\\Temp\\index.html</path>\n<content><!DOCTYPE html>\n<html>hello</html></content>\n</file-write>');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Write",
        arguments: JSON.stringify({
          file_path: "C:\\Temp\\index.html",
          content: "<!DOCTYPE html>\n<html>hello</html>",
        }),
      },
    });
  });

  it("turns multiple DeepSeek file-write blocks into Write tool calls", () => {
    const calls = detectToolCalls('<file-write>\n<path>index.html</path>\n<content><html></html></content>\n</file-write>\n<file-write>\n<path>styles.css</path>\n<content>body { color: red; }</content>\n</file-write>');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      type: "function",
      function: { name: "Write", arguments: JSON.stringify({ file_path: "index.html", content: "<html></html>" }) },
    });
    expect(calls[1]).toMatchObject({
      type: "function",
      function: { name: "Write", arguments: JSON.stringify({ file_path: "styles.css", content: "body { color: red; }" }) },
    });
  });

  it("turns file-write blocks with file-content close tags into Write tool calls", () => {
    const call = detectToolCall('<file-write>\n<path>index.html</path>\n<content><html></html></file-content>\n</file-write>');

    expect(call).toMatchObject({
      type: "function",
      function: { name: "Write", arguments: JSON.stringify({ file_path: "index.html", content: "<html></html>" }) },
    });
  });

  it("turns function-style Write output into Write tool calls", () => {
    const call = detectToolCall('Write(,C:\\Temp\\index.html,<!DOCTYPE html>\n<html>hello</html>\n)');

    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Write",
        arguments: JSON.stringify({
          file_path: "C:\\Temp\\index.html",
          content: "<!DOCTYPE html>\n<html>hello</html>",
        }),
      },
    });
  });

  it("turns Write JSON wrapper output into Write tool calls", () => {
    const call = detectToolCall('Write({"file_path":"C:\\\\Temp\\\\index.html","content":"hello"})');

    expect(call).toMatchObject({
      type: "function",
      function: { name: "Write", arguments: JSON.stringify({ file_path: "C:\\Temp\\index.html", content: "hello" }) },
    });
  });

  it("turns multiple Write JSON wrapper outputs into Write tool calls", () => {
    const calls = detectToolCalls('Write({"file_path":"index.html","content":"html"})\nWrite({"file_path":"styles.css","content":"body { color: red; }"})');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ type: "function", function: { name: "Write", arguments: JSON.stringify({ file_path: "index.html", content: "html" }) } });
    expect(calls[1]).toMatchObject({ type: "function", function: { name: "Write", arguments: JSON.stringify({ file_path: "styles.css", content: "body { color: red; }" }) } });
  });

  it("returns null for normal prose", () => {
    expect(detectToolCall("hello world")).toBeNull();
  });

  it("extracts a tool call from a fenced json block placed after prose", () => {
    const text = 'I\'ll use the frontend-design skill to generate a landing page.\n\n```json\n{"tool":"Skill","args":{"skill":"frontend-design:frontend-design","args":"Create a landing page"}}\n```';
    const call = detectToolCall(text);
    expect(call).toMatchObject({
      type: "function",
      function: {
        name: "Skill",
        arguments: JSON.stringify({ skill: "frontend-design:frontend-design", args: "Create a landing page" }),
      },
    });
  });

  it("extracts a bare tool json object embedded after prose", () => {
    const text = 'Let me read that file. {"tool":"Read","args":{"file_path":"a.txt"}}';
    const call = detectToolCall(text);
    expect(call).toMatchObject({
      type: "function",
      function: { name: "Read", arguments: JSON.stringify({ file_path: "a.txt" }) },
    });
  });

  it("does not treat plain prose with braces as a tool call", () => {
    expect(detectToolCall("Use the {placeholder} syntax to insert a value.")).toBeNull();
  });

  it("extracts a Write tool_call that uses file_path/content child tags with HTML inside", () => {
    const text = 'Let me write the file.\n\n<tool_call name="Write">\n<file_path>F:\\Project\\Second Brain\\index.html</file_path>\n<content><!DOCTYPE html>\n<html lang="en">\n<head><title>NEXUS</title></head>\n<body>hi</body>\n</html></content>\n</tool_call>';
    const call = detectToolCall(text);
    expect(call.function.name).toBe("Write");
    const args = JSON.parse(call.function.arguments);
    expect(args.file_path).toBe("F:\\Project\\Second Brain\\index.html");
    expect(args.content).toContain("<!DOCTYPE html>");
    expect(args.content).toContain("<title>NEXUS</title>");
    // tags inside the HTML body must NOT leak in as tool args
    expect(args.title).toBeUndefined();
    expect(args.head).toBeUndefined();
  });

  it("extracts a tool_call with <path>/<content> child tags as a Write", () => {
    const text = '<tool_call name="Write">\n<path>a.html</path>\n<content><html>x</html></content>\n</tool_call>';
    const call = detectToolCall(text);
    expect(call.function.name).toBe("Write");
    const args = JSON.parse(call.function.arguments);
    expect(args.file_path).toBe("a.html");
    expect(args.content).toBe("<html>x</html>");
  });

  it("turns multiple embedded Claude-style tool calls into OpenAI tool calls", () => {
    const calls = detectToolCalls('Read both files.\n<tool_call name="Read">\n{"file_path":"one.txt"}\n</tool_call>\n<tool_call name="Read">\n{"file_path":"two.txt","limit":5}\n</tool_call>');

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      type: "function",
      function: { name: "Read", arguments: JSON.stringify({ file_path: "one.txt" }) },
    });
    expect(calls[1]).toMatchObject({
      type: "function",
      function: { name: "Read", arguments: JSON.stringify({ file_path: "two.txt", limit: 5 }) },
    });
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

  it("reuses one DeepSeek chat session while message history grows", async () => {
    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });

    await exec.execute({
      model: "deepseek-web/expert-deepthink-search",
      body: { messages: [{ role: "user", content: "one" }], stream: false },
      stream: false,
      credentials: { apiKey: "tok-1", connectionId: "conn-1" },
    });
    await exec.execute({
      model: "deepseek-web/expert-deepthink-search",
      body: {
        messages: [
          { role: "user", content: "one" },
          { role: "assistant", content: "two" },
          { role: "user", content: "three" },
        ],
        stream: false,
      },
      stream: false,
      credentials: { apiKey: "tok-1", connectionId: "conn-1" },
    });

    expect(calls.filter((call) => call.url.endsWith("/api/v0/chat_session/create"))).toHaveLength(1);
    expect(calls.filter((call) => call.url.endsWith("/api/v0/chat/completion")).map((call) => call.body.chat_session_id)).toEqual(["session-1", "session-1"]);
  });

  it("starts a new DeepSeek chat session when message history shrinks", async () => {
    let sessionNo = 0;
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.endsWith("/api/v0/chat_session/create")) {
        sessionNo += 1;
        return new Response(JSON.stringify({
          code: 0,
          data: { biz_code: 0, biz_data: { chat_session: { id: `session-${sessionNo}` } } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/create_pow_challenge")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { challenge: { algorithm: "DeepSeekHashV1", challenge: "challenge-1", salt: "salt-1", signature: "sig-1", difficulty: 3, expire_at: 123456, target_path: "/api/v0/chat/completion" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/completion")) {
        return sseResponse('data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"hi"}]}}}\n\n');
      }
      return new Response("not found", { status: 404 });
    });

    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });
    await exec.execute({
      model: "deepseek-web/expert-deepthink-search",
      body: {
        messages: [
          { role: "user", content: "one" },
          { role: "assistant", content: "two" },
          { role: "user", content: "three" },
        ],
        stream: false,
      },
      stream: false,
      credentials: { apiKey: "tok-1", connectionId: "conn-1" },
    });
    await exec.execute({
      model: "deepseek-web/expert-deepthink-search",
      body: { messages: [{ role: "user", content: "new" }], stream: false },
      stream: false,
      credentials: { apiKey: "tok-1", connectionId: "conn-1" },
    });

    expect(calls.filter((call) => call.url.endsWith("/api/v0/chat_session/create"))).toHaveLength(2);
    expect(calls.filter((call) => call.url.endsWith("/api/v0/chat/completion")).map((call) => call.body.chat_session_id)).toEqual(["session-1", "session-2"]);
  });

  it("reprompts once when DeepSeek returns malformed tool intent", async () => {
    let completionNo = 0;
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.endsWith("/api/v0/chat_session/create")) {
        return new Response(JSON.stringify({
          code: 0,
          data: { biz_code: 0, biz_data: { chat_session: { id: "session-1" } } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/create_pow_challenge")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { challenge: { algorithm: "DeepSeekHashV1", challenge: "challenge-1", salt: "salt-1", signature: "sig-1", difficulty: 3, expire_at: 123456, target_path: "/api/v0/chat/completion" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/completion")) {
        completionNo += 1;
        if (completionNo === 1) {
          return sseResponse('data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"I need a tool. <tool_call name=Read> file_path: package.json"}]}}}\n\n');
        }
        return sseResponse('data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"{\\"tool\\":\\"Read\\",\\"args\\":{\\"file_path\\":\\"package.json\\"}}"}]}}}\n\n');
      }
      return new Response("not found", { status: 404 });
    });

    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });
    const { response } = await exec.execute({
      model: "deepseek-web/expert-deepthink-search",
      body: {
        messages: [{ role: "user", content: "read package.json" }],
        tools: [{ type: "function", function: { name: "Read", parameters: { type: "object", properties: { file_path: { type: "string" } } } } }],
        stream: false,
      },
      stream: false,
      credentials: { apiKey: "tok-1" },
    });

    const json = await response.json();
    const completionCalls = calls.filter((call) => call.url.endsWith("/api/v0/chat/completion"));
    expect(completionCalls).toHaveLength(2);
    expect(completionCalls[1].body.prompt).toContain("Return exactly one valid tool JSON object");
    expect(json.choices[0].message.tool_calls[0].function).toMatchObject({
      name: "Read",
      arguments: JSON.stringify({ file_path: "package.json" }),
    });
  });

  it("reprompts once when DeepSeek returns parameter-only tool intent", async () => {
    let completionNo = 0;
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.endsWith("/api/v0/chat_session/create")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { chat_session: { id: "session-1" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/create_pow_challenge")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { challenge: { algorithm: "DeepSeekHashV1", challenge: "challenge-1", salt: "salt-1", signature: "sig-1", difficulty: 3, expire_at: 123456, target_path: "/api/v0/chat/completion" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/completion")) {
        completionNo += 1;
        if (completionNo === 1) {
          return sseResponse('data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"Write file.\\n\\n<parameter name=\\"file_path\\">index.html</parameter>\\n<parameter name=\\"content\\">hello</parameter>\\n</invoke>"}]}}}\n\n');
        }
        return sseResponse('data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"{\\"tool\\":\\"Write\\",\\"args\\":{\\"file_path\\":\\"index.html\\",\\"content\\":\\"hello\\"}}"}]}}}\n\n');
      }
      return new Response("not found", { status: 404 });
    });

    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });
    const { response } = await exec.execute({
      model: "deepseek-web/expert-deepthink-search",
      body: {
        messages: [{ role: "user", content: "write index" }],
        tools: [{ type: "function", function: { name: "Write", parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } } } } }],
        stream: false,
      },
      stream: false,
      credentials: { apiKey: "tok-1" },
    });

    const json = await response.json();
    const completionCalls = calls.filter((call) => call.url.endsWith("/api/v0/chat/completion"));
    expect(completionCalls).toHaveLength(2);
    expect(completionCalls[1].body.prompt).toContain("Return exactly one valid tool JSON object");
    expect(json.choices[0].message.tool_calls[0].function).toMatchObject({
      name: "Write",
      arguments: JSON.stringify({ file_path: "index.html", content: "hello" }),
    });
  });

  it("reprompts once when DeepSeek returns an empty completion", async () => {
    let completionNo = 0;
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.endsWith("/api/v0/chat_session/create")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { chat_session: { id: "session-1" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/create_pow_challenge")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { challenge: { algorithm: "DeepSeekHashV1", challenge: "challenge-1", salt: "salt-1", signature: "sig-1", difficulty: 3, expire_at: 123456, target_path: "/api/v0/chat/completion" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/completion")) {
        completionNo += 1;
        if (completionNo === 1) return sseResponse("event: ready\ndata: {}\n\nevent: close\ndata: {}\n\n");
        return sseResponse('data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"Recovered answer"}]}}}\n\n');
      }
      return new Response("not found", { status: 404 });
    });

    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });
    const { response } = await exec.execute({
      model: "deepseek-web/expert-deepthink-search",
      body: {
        messages: [
          { role: "user", content: "Use Bash, then explain result" },
          { role: "assistant", tool_calls: [{ id: "call_bash", type: "function", function: { name: "Bash", arguments: JSON.stringify({ command: "Get-ChildItem", description: "List files" }) } }] },
          { role: "tool", tool_call_id: "call_bash", content: "Exit code 127\n/usr/bin/bash: line 1: Get-ChildItem: command not found" },
        ],
        stream: false,
      },
      stream: false,
      credentials: { apiKey: "tok-1" },
    });

    const json = await response.json();
    const completionCalls = calls.filter((call) => call.url.endsWith("/api/v0/chat/completion"));
    expect(completionCalls).toHaveLength(2);
    expect(completionCalls[1].body.prompt).toContain("Your previous response was empty");
    expect(json.choices[0].message.content).toBe("Recovered answer");
  });

  it("returns an error when DeepSeek keeps returning empty completions", async () => {
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.endsWith("/api/v0/chat_session/create")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { chat_session: { id: "session-1" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/create_pow_challenge")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { challenge: { algorithm: "DeepSeekHashV1", challenge: "challenge-1", salt: "salt-1", signature: "sig-1", difficulty: 3, expire_at: 123456, target_path: "/api/v0/chat/completion" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/completion")) return sseResponse("event: ready\ndata: {}\n\nevent: close\ndata: {}\n\n");
      return new Response("not found", { status: 404 });
    });

    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });
    const { response } = await exec.execute({
      model: "deepseek-web/expert-deepthink-search",
      body: { messages: [{ role: "user", content: "hello" }], stream: false },
      stream: false,
      credentials: { apiKey: "tok-1" },
    });

    const json = await response.json();
    const completionCalls = calls.filter((call) => call.url.endsWith("/api/v0/chat/completion"));
    expect(completionCalls).toHaveLength(2);
    expect(response.status).toBe(502);
    expect(json.error.message).toBe("DeepSeek returned empty completion");
  });
});

describe("DeepSeekWebExecutor stateful chaining", () => {
  let calls;
  let completionQueue;

  function sseWithId(responseMessageId, content) {
    return sseResponse([
      `data: {"request_message_id":${responseMessageId - 1},"response_message_id":${responseMessageId},"model_type":"default"}`,
      "",
      `data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":${JSON.stringify(content)}}]}}}`,
      "",
    ].join("\n"));
  }

  beforeEach(() => {
    calls = [];
    completionQueue = [];
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.endsWith("/api/v0/chat_session/create")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { chat_session: { id: "session-1" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/create_pow_challenge")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { challenge: { algorithm: "DeepSeekHashV1", challenge: "challenge-1", salt: "salt-1", signature: "sig-1", difficulty: 3, expire_at: 123456, target_path: "/api/v0/chat/completion" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/completion")) {
        const next = completionQueue.shift();
        return sseWithId(next.id, next.content);
      }
      return new Response("not found", { status: 404 });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const tools = [{ type: "function", function: { name: "Write", parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } } } } }];

  it("chains parent_message_id to the prior response and sends only the delta on reuse", async () => {
    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });
    completionQueue = [
      { id: 100, content: '{"tool":"Write","args":{"file_path":"a.html","content":"hi"}}' },
      { id: 200, content: "Done." },
    ];

    await exec.execute({
      model: "deepseek-web/expert-agentic",
      body: { messages: [{ role: "user", content: "build landing page" }], tools, stream: false },
      stream: false,
      credentials: { apiKey: "tok-1", connectionId: "conn-chain" },
    });

    await exec.execute({
      model: "deepseek-web/expert-agentic",
      body: {
        messages: [
          { role: "user", content: "build landing page" },
          { role: "assistant", tool_calls: [{ id: "call_w", type: "function", function: { name: "Write", arguments: JSON.stringify({ file_path: "a.html", content: "hi" }) } }] },
          { role: "tool", tool_call_id: "call_w", content: "file written ok" },
        ],
        tools,
        stream: false,
      },
      stream: false,
      credentials: { apiKey: "tok-1", connectionId: "conn-chain" },
    });

    const completionCalls = calls.filter((call) => call.url.endsWith("/api/v0/chat/completion"));
    const sessionCreates = calls.filter((call) => call.url.endsWith("/api/v0/chat_session/create"));
    expect(sessionCreates).toHaveLength(1);
    expect(completionCalls).toHaveLength(2);

    // turn 1: first contact, no parent
    expect(completionCalls[0].body.parent_message_id).toBeNull();
    // turn 2: chained to turn 1's response id
    expect(completionCalls[1].body.parent_message_id).toBe(100);

    // turn 2 prompt is a delta: carries the new tool result, drops the old user turn
    expect(completionCalls[1].body.prompt).toContain("file written ok");
    expect(completionCalls[1].body.prompt).not.toContain("build landing page");
  });

  it("keeps the same parent_message_id across an in-turn retry instead of advancing", async () => {
    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });
    completionQueue = [
      { id: 100, content: "ok" },
      { id: 150, content: "I need a tool. <tool_call name=Write> file_path: a.html" },
      { id: 200, content: '{"tool":"Write","args":{"file_path":"a.html","content":"hi"}}' },
    ];

    await exec.execute({
      model: "deepseek-web/expert-agentic",
      body: { messages: [{ role: "user", content: "start" }], tools, stream: false },
      stream: false,
      credentials: { apiKey: "tok-1", connectionId: "conn-retry" },
    });

    await exec.execute({
      model: "deepseek-web/expert-agentic",
      body: {
        messages: [
          { role: "user", content: "start" },
          { role: "assistant", content: "ok" },
          { role: "user", content: "now write the file" },
        ],
        tools,
        stream: false,
      },
      stream: false,
      credentials: { apiKey: "tok-1", connectionId: "conn-retry" },
    });

    const completionCalls = calls.filter((call) => call.url.endsWith("/api/v0/chat/completion"));
    // turn 1 + turn 2 (malformed) + turn 2 (repair) = 3
    expect(completionCalls).toHaveLength(3);
    // both turn-2 attempts chain to turn 1's response (100); the bad sibling (150) is never used as parent
    expect(completionCalls[1].body.parent_message_id).toBe(100);
    expect(completionCalls[2].body.parent_message_id).toBe(100);
  });
});

describe("DeepSeekWebExecutor live streaming", () => {
  let calls;
  let completionQueue;

  function sseThink(responseMessageId, think, response) {
    return sseResponse([
      `data: {"request_message_id":${responseMessageId - 1},"response_message_id":${responseMessageId},"model_type":"expert"}`,
      "",
      `data: {"v":{"response":{"fragments":[{"type":"THINK","content":${JSON.stringify(think)}}]}}}`,
      "",
      `data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":${JSON.stringify(response)}}]}}}`,
      "",
    ].join("\n"));
  }

  async function drain(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let out = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
  }

  const tools = [{ type: "function", function: { name: "Write", parameters: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } } } } }];

  beforeEach(() => {
    calls = [];
    completionQueue = [];
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
      if (url.endsWith("/api/v0/chat_session/create")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { chat_session: { id: "session-1" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/create_pow_challenge")) {
        return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { challenge: { algorithm: "DeepSeekHashV1", challenge: "c", salt: "s", signature: "sig", difficulty: 3, expire_at: 1, target_path: "/api/v0/chat/completion" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/v0/chat/completion")) {
        const next = completionQueue.shift();
        return sseThink(next.id, next.think, next.response);
      }
      return new Response("not found", { status: 404 });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("streams thinking live, then emits the tool call and DONE", async () => {
    completionQueue = [{ id: 50, think: "thinking...", response: '{"tool":"Write","args":{"file_path":"a.html","content":"hi"}}' }];
    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });
    const { response } = await exec.execute({
      model: "deepseek-web/expert-deepthink-agentic",
      body: { messages: [{ role: "user", content: "go" }], tools, stream: true },
      stream: true,
      credentials: { apiKey: "tok-1", connectionId: "conn-live" },
    });

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const out = await drain(response);

    expect(out).toContain('"reasoning_content":"thinking..."');
    expect(out).toContain('"name":"Write"');
    expect(out).toContain('"finish_reason":"tool_calls"');
    expect(out).toContain("[DONE]");
    // thinking is flushed live, before the buffered tool call
    expect(out.indexOf("reasoning_content")).toBeLessThan(out.indexOf("tool_calls"));
  });

  it("chains parent_message_id across streamed turns and sends only the delta", async () => {
    completionQueue = [
      { id: 50, think: "t1", response: '{"tool":"Write","args":{"file_path":"a.html","content":"hi"}}' },
      { id: 60, think: "t2", response: "Done." },
    ];
    const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });

    const r1 = await exec.execute({
      model: "deepseek-web/expert-deepthink-agentic",
      body: { messages: [{ role: "user", content: "go" }], tools, stream: true },
      stream: true,
      credentials: { apiKey: "tok-1", connectionId: "conn-live2" },
    });
    await drain(r1.response);

    const r2 = await exec.execute({
      model: "deepseek-web/expert-deepthink-agentic",
      body: {
        messages: [
          { role: "user", content: "go" },
          { role: "assistant", tool_calls: [{ id: "call_w", type: "function", function: { name: "Write", arguments: JSON.stringify({ file_path: "a.html", content: "hi" }) } }] },
          { role: "tool", tool_call_id: "call_w", content: "written ok" },
        ],
        tools,
        stream: true,
      },
      stream: true,
      credentials: { apiKey: "tok-1", connectionId: "conn-live2" },
    });
    await drain(r2.response);

    const completionCalls = calls.filter((call) => call.url.endsWith("/api/v0/chat/completion"));
    expect(completionCalls).toHaveLength(2);
    expect(completionCalls[0].body.parent_message_id).toBeNull();
    expect(completionCalls[1].body.parent_message_id).toBe(50);
    expect(completionCalls[1].body.prompt).toContain("written ok");
    expect(completionCalls[1].body.prompt).not.toContain("Current user request");
  });
});
