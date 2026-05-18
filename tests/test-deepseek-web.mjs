import {
  buildDeepSeekHeaders,
  buildDeepSeekPrompt,
  buildPowHeaderValue,
  detectToolCall,
  mapDeepSeekModel,
  parseDeepSeekSse,
  probeDeepSeekWebToken,
  DeepSeekWebExecutor,
} from "../open-sse/executors/deepseek-web.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("PASS", name); }
  catch (e) { fail++; console.log("FAIL", name, "-", e.message); }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || ""}: expected ${B}, got ${A}`);
}

t("mapDeepSeekModel instant plain", () => {
  eq(mapDeepSeekModel("deepseek-web/instant", {}), { modelType: "default", thinkingEnabled: false, searchEnabled: false });
});
t("mapDeepSeekModel expert-deepthink-search", () => {
  eq(mapDeepSeekModel("deepseek-web/expert-deepthink-search", {}), { modelType: "expert", thinkingEnabled: true, searchEnabled: true });
});
t("mapDeepSeekModel reasoning_effort enables thinking", () => {
  eq(mapDeepSeekModel("deepseek-web/instant", { reasoning_effort: "high" }), { modelType: "default", thinkingEnabled: true, searchEnabled: false });
});

t("buildPowHeaderValue base64 encode", () => {
  const h = buildPowHeaderValue({ algorithm: "DeepSeekHashV1", challenge: "c1", salt: "s1", signature: "sg", answer: 42, target_path: "/api/v0/chat/completion" });
  const dec = JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  eq(dec, { algorithm: "DeepSeekHashV1", challenge: "c1", salt: "s1", answer: 42, signature: "sg", target_path: "/api/v0/chat/completion" });
});

t("buildDeepSeekHeaders bearer + pow", () => {
  const h = buildDeepSeekHeaders({ apiKey: "tok-1" }, { powHeader: "pow-1" });
  if (h.Authorization !== "Bearer tok-1") throw new Error("auth wrong");
  if (h["x-ds-pow-response"] !== "pow-1") throw new Error("pow wrong");
  if (h["x-client-platform"] !== "web") throw new Error("client-platform wrong");
});

// Probe test
let probeCalls;
const originalProbeFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  probeCalls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
  return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { chat_session: { id: "session-probe" } } } }), { status: probeCalls[0]?.opts?.headers?.Authorization === "Bearer bad-token" ? 401 : 200, headers: { "Content-Type": "application/json" } });
};

await (async () => {
  try {
    probeCalls = [];
    const result = await probeDeepSeekWebToken("tok-1");
    if (result.valid !== true || result.error !== null) throw new Error("valid token rejected");
    if (probeCalls.length !== 1) throw new Error("expected one probe call");
    if (probeCalls[0].opts.headers.Authorization !== "Bearer tok-1") throw new Error("auth wrong");
    pass++;
    console.log("PASS probeDeepSeekWebToken accepts session create 200");
  } catch (e) {
    fail++;
    console.log("FAIL probeDeepSeekWebToken accepts session create 200 -", e.message);
  }

  try {
    probeCalls = [];
    const result = await probeDeepSeekWebToken("bad-token");
    if (result.valid !== false || !result.error.includes("expired")) throw new Error("invalid token accepted");
    pass++;
    console.log("PASS probeDeepSeekWebToken rejects auth failure");
  } catch (e) {
    fail++;
    console.log("FAIL probeDeepSeekWebToken rejects auth failure -", e.message);
  }
})();

globalThis.fetch = originalProbeFetch;

t("buildDeepSeekPrompt with tools", () => {
  const p = buildDeepSeekPrompt({
    messages: [
      { role: "system", content: "Be precise" },
      { role: "user", content: "List files" },
    ],
    tools: [{ type: "function", function: { name: "list_files", description: "List files in a directory", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } }],
  });
  if (!p.includes("Instructions:\nBe precise")) throw new Error("instructions missing");
  if (!p.includes("Current user request:\nList files")) throw new Error("current request missing");
  if (!p.includes("- list_files(path:string): List files in a directory")) throw new Error("tool line missing");
});

t("parseDeepSeekSse think + response", () => {
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
  const r = parseDeepSeekSse(sse);
  eq({ content: r.content, reasoningContent: r.reasoningContent, usage: r.usage, requestMessageId: r.requestMessageId, responseMessageId: r.responseMessageId, modelType: r.modelType },
    { content: "answer", reasoningContent: "thinking", usage: { completion_tokens: 9 }, requestMessageId: 1, responseMessageId: 2, modelType: "expert" });
});

t("detectToolCall JSON", () => {
  const c = detectToolCall('{"tool":"list_files","args":{"path":"."}}');
  if (!c || c.type !== "function" || c.function.name !== "list_files" || c.function.arguments !== JSON.stringify({path:"."})) throw new Error("bad tool call");
  if (!/^call_/.test(c.id)) throw new Error("bad id");
});

t("detectToolCall null on prose", () => {
  if (detectToolCall("hello world") !== null) throw new Error("should be null");
});

// Executor test
let calls;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  calls.push({ url, opts, body: opts?.body ? JSON.parse(opts.body) : null });
  if (url.endsWith("/api/v0/chat_session/create")) {
    return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { chat_session: { id: "session-1" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/api/v0/chat/create_pow_challenge")) {
    return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { challenge: { algorithm: "DeepSeekHashV1", challenge: "c1", salt: "s1", signature: "sg", difficulty: 3, expire_at: 1, expire_after: 300000, target_path: "/api/v0/chat/completion" } } } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.endsWith("/api/v0/chat/completion")) {
    const text = [
      "event: ready",
      'data: {"request_message_id":1,"response_message_id":2,"model_type":"default"}',
      "",
      'data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"hi"}]}}}',
      "",
      'data: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":2}]}',
      "",
      "event: close",
      "data: {}",
      "",
    ].join("\n");
    return new Response(new Blob([text]).stream(), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }
  return new Response("not found", { status: 404 });
};

const run = async () => {
  calls = [];
  const exec = new DeepSeekWebExecutor({ solvePow: async () => 7 });
  const { response } = await exec.execute({
    model: "deepseek-web/expert-deepthink-search",
    body: { messages: [{ role: "user", content: "hello" }], stream: false },
    stream: false,
    credentials: { apiKey: "tok-1" },
  });
  if (response.status !== 200) throw new Error("status " + response.status);
  const json = await response.json();
  if (json.choices[0].message.content !== "hi") throw new Error("content wrong");
  const completionCall = calls.find((c) => c.url.endsWith("/api/v0/chat/completion"));
  if (completionCall.body.chat_session_id !== "session-1") throw new Error("session-id wrong");
  if (completionCall.body.model_type !== "expert") throw new Error("model_type wrong");
  if (completionCall.body.thinking_enabled !== true) throw new Error("thinking wrong");
  if (completionCall.body.search_enabled !== true) throw new Error("search wrong");
  const powHeader = completionCall.opts.headers["x-ds-pow-response"];
  const decodedPow = JSON.parse(Buffer.from(powHeader, "base64").toString("utf8"));
  if (decodedPow.answer !== 7) throw new Error("pow answer wrong");
  if (decodedPow.target_path !== "/api/v0/chat/completion") throw new Error("target_path wrong");
};

await (async () => {
  try { await run(); pass++; console.log("PASS executor.execute"); }
  catch (e) { fail++; console.log("FAIL executor.execute -", e.message); }
})();

globalThis.fetch = originalFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
