import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, resolveToken, connectionIdFor, MODEL_IDS } from "../src/server.js";

function fakeExecutor() {
  const calls = [];
  return {
    calls,
    async execute(args) {
      calls.push(args);
      if (args.stream) {
        const body = new Blob(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', "data: [DONE]\n\n"]).stream();
        return { response: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }) };
      }
      const payload = { id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }] };
      return { response: new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }) };
    },
  };
}

describe("resolveToken", () => {
  it("passes the caller bearer through as the DeepSeek token", () => {
    expect(resolveToken("ds-token", { deepseekToken: "", accessKey: "" })).toBe("ds-token");
  });

  it("swaps a matching access key for the configured DeepSeek token", () => {
    expect(resolveToken("secret", { deepseekToken: "ds-env", accessKey: "secret" })).toBe("ds-env");
  });

  it("rejects a missing bearer when an access key guards the env token", () => {
    expect(resolveToken("", { deepseekToken: "ds-env", accessKey: "secret" })).toBeNull();
  });

  it("uses the env token when no access key is configured and no bearer is sent", () => {
    expect(resolveToken("", { deepseekToken: "ds-env", accessKey: "" })).toBe("ds-env");
  });

  it("returns null when nothing is available", () => {
    expect(resolveToken("", { deepseekToken: "", accessKey: "" })).toBeNull();
  });
});

describe("connectionIdFor", () => {
  it("is stable per token and differs across tokens", () => {
    expect(connectionIdFor("a")).toBe(connectionIdFor("a"));
    expect(connectionIdFor("a")).not.toBe(connectionIdFor("b"));
    expect(connectionIdFor("a")).toHaveLength(16);
  });
});

describe("HTTP server", () => {
  let server;
  let base;
  const executor = fakeExecutor();

  beforeAll(async () => {
    server = createServer({ executor, tokenOptions: { deepseekToken: "", accessKey: "" } });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("reports health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  it("lists plain and agentic models", async () => {
    const res = await fetch(`${base}/v1/models`);
    const ids = (await res.json()).data.map((m) => m.id);
    expect(ids).toEqual(MODEL_IDS);
    expect(ids).toContain("expert-deepthink-search");
    expect(ids).toContain("instant-agentic");
  });

  it("requires a bearer token for completions", async () => {
    const res = await fetch(`${base}/v1/chat/completions`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("rejects invalid JSON", async () => {
    const res = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { Authorization: "Bearer t" }, body: "{nope" });
    expect(res.status).toBe(400);
  });

  it("forwards a non-stream completion with token-derived credentials", async () => {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer tok-1", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "expert", messages: [{ role: "user", content: "hello" }] }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("hi");
    const call = executor.calls.at(-1);
    expect(call.model).toBe("expert");
    expect(call.stream).toBe(false);
    expect(call.credentials).toEqual({ apiKey: "tok-1", connectionId: connectionIdFor("tok-1") });
  });

  it("pipes a streaming completion as SSE", async () => {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: "Bearer tok-1" },
      body: JSON.stringify({ model: "instant", stream: true, messages: [{ role: "user", content: "hello" }] }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"content":"hi"');
    expect(text).toContain("[DONE]");
  });

  it("404s unknown routes", async () => {
    const res = await fetch(`${base}/v1/embeddings`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
