import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

const DEEPSEEK_ORIGIN = "https://chat.deepseek.com";
const CHAT_SESSION_CREATE_URL = `${DEEPSEEK_ORIGIN}/api/v0/chat_session/create`;
const CREATE_POW_CHALLENGE_URL = `${DEEPSEEK_ORIGIN}/api/v0/chat/create_pow_challenge`;
const CHAT_COMPLETION_URL = `${DEEPSEEK_ORIGIN}/api/v0/chat/completion`;
const CHAT_COMPLETION_PATH = "/api/v0/chat/completion";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const MODEL_FLAGS = {
  instant: { modelType: "default", thinkingEnabled: false, searchEnabled: false },
  "instant-search": { modelType: "default", thinkingEnabled: false, searchEnabled: true },
  "instant-deepthink": { modelType: "default", thinkingEnabled: true, searchEnabled: false },
  "instant-deepthink-search": { modelType: "default", thinkingEnabled: true, searchEnabled: true },
  expert: { modelType: "expert", thinkingEnabled: false, searchEnabled: false },
  "expert-search": { modelType: "expert", thinkingEnabled: false, searchEnabled: true },
  "expert-deepthink": { modelType: "expert", thinkingEnabled: true, searchEnabled: false },
  "expert-deepthink-search": { modelType: "expert", thinkingEnabled: true, searchEnabled: true },
};

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

function stripProviderPrefix(model) {
  return String(model || "instant").replace(/^deepseek-web\//, "");
}

function getSessionCacheKey(model, credentials = {}) {
  return `${credentials.connectionId || credentials.connectionName || "default"}:${stripProviderPrefix(model)}`;
}

function getMessageCount(body = {}) {
  return Array.isArray(body.messages) ? body.messages.length : 0;
}

async function getChatSessionId({ model, body, credentials, headers, signal, sessionTtlMs, sessionCache }) {
  const now = Date.now();
  const key = getSessionCacheKey(model, credentials);
  const messageCount = getMessageCount(body);
  const cached = sessionCache.get(key);
  const canReuse = cached
    && now - cached.updatedAt < sessionTtlMs
    && messageCount >= cached.messageCount;

  if (canReuse) {
    cached.messageCount = messageCount;
    cached.updatedAt = now;
    return cached.chatSessionId;
  }

  const response = await fetch(CHAT_SESSION_CREATE_URL, { method: "POST", headers, body: "{}", signal });
  if (!response.ok) return { errorStatus: response.status };
  const data = await parseJsonResponse(response, "DeepSeek session create");
  const chatSessionId = data.chat_session?.id;
  if (!chatSessionId) throw new Error("DeepSeek session response missing chat_session.id");

  sessionCache.set(key, { chatSessionId, messageCount, updatedAt: now });
  return chatSessionId;
}

export function mapDeepSeekModel(model, body = {}) {
  const key = stripProviderPrefix(model);
  const mapped = MODEL_FLAGS[key] || MODEL_FLAGS.instant;
  const thinkingRequested = body?.thinking === true || body?.thinking?.type === "enabled" || (body?.reasoning_effort != null && body.reasoning_effort !== "none");
  const modelExplicitlyDisablesThinking = key === "instant" || key === "instant-search" || key === "expert" || key === "expert-search";

  return {
    modelType: mapped.modelType,
    thinkingEnabled: mapped.thinkingEnabled || (thinkingRequested && !modelExplicitlyDisablesThinking) || thinkingRequested,
    searchEnabled: mapped.searchEnabled,
  };
}

export function buildPowHeaderValue(pow) {
  return Buffer.from(JSON.stringify({
    algorithm: pow.algorithm,
    challenge: pow.challenge,
    salt: pow.salt,
    answer: pow.answer,
    signature: pow.signature,
    target_path: pow.target_path || pow.targetPath || CHAT_COMPLETION_PATH,
  })).toString("base64");
}

export function buildDeepSeekHeaders(credentials = {}, options = {}) {
  const token = credentials.accessToken || credentials.apiKey || "";
  const headers = {
    Accept: "*/*",
    "Content-Type": "application/json",
    "x-client-platform": "web",
    "x-client-version": "2.0.0",
    "x-client-locale": "en_US",
    "x-client-timezone-offset": String(new Date().getTimezoneOffset() * -60),
    "x-app-version": "2.0.0",
    "User-Agent": USER_AGENT,
  };

  if (token) headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  if (options.powHeader) headers["x-ds-pow-response"] = options.powHeader;
  if (options.referer) headers.Referer = options.referer;
  return headers;
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part?.text === "string") return part.text;
      if (part?.type === "tool_result") return JSON.stringify(part.content ?? "");
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function formatToolParameters(tool) {
  const fn = tool?.function || tool || {};
  const properties = fn.parameters?.properties || {};
  const required = new Set(fn.parameters?.required || []);
  const args = Object.entries(properties).map(([name, schema]) => `${name}${required.has(name) ? "" : "?"}:${schema?.type || "any"}`);
  return args.join(",");
}

function formatTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  const lines = tools.map((tool) => {
    const fn = tool?.function || tool || {};
    const name = fn.name || "unnamed";
    const description = String(fn.description || "").split("\n")[0].slice(0, 160);
    return `- ${name}(${formatToolParameters(tool)}): ${description}`;
  });
  return [
    "Tools are available. Call EXACTLY ONE tool per response — never two tools at once.",
    "The Bash tool runs PowerShell on Windows. Use PowerShell syntax (Get-ChildItem, not ls; $env:VAR not $VAR).",
    "To call a tool, respond with exactly one JSON object and no markdown:",
    '{"tool":"tool_name","args":{}}',
    "Available tools:",
    ...lines,
    "If no tool is needed, answer normally.",
  ].join("\n");
}

export function buildDeepSeekPrompt(body = {}) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const instructionParts = [];
  const historyParts = [];
  let currentUser = "";

  for (const message of messages) {
    const role = message.role === "developer" ? "system" : message.role;

    if (role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const toolDesc = message.tool_calls
        .map((tc) => {
          const args = tc.function?.arguments || "{}";
          const compact = args.length > 80 ? args.slice(0, 80) + "…" : args;
          return `${tc.function?.name || "unknown"}(${compact})`;
        })
        .join(", ");
      historyParts.push(`assistant: [called ${toolDesc}]`);
      const text = contentToText(message.content).trim();
      if (text) historyParts.push(`assistant: ${text}`);
      continue;
    }

    const text = contentToText(message.content).trim();
    if (!text) continue;

    if (role === "system") {
      instructionParts.push(text);
    } else if (role === "user") {
      currentUser = text;
      historyParts.push(`user: ${text}`);
    } else if (role === "assistant") {
      historyParts.push(`assistant: ${text}`);
    } else if (role === "tool") {
      const truncated = text.length > 800 ? text.slice(0, 800) + "...(truncated)" : text;
      historyParts.push(`tool ${message.name || message.tool_call_id || "result"}: ${truncated}`);
    }
  }

  if (currentUser && historyParts.length > 0 && historyParts[historyParts.length - 1] === `user: ${currentUser}`) {
    historyParts.pop();
  }

  const sections = [];
  const toolText = formatTools(body.tools);
  if (instructionParts.length || toolText) {
    sections.push(`Instructions:\n${[...instructionParts, toolText].filter(Boolean).join("\n\n")}`);
  }
  if (historyParts.length) sections.push(`Conversation so far:\n${historyParts.join("\n")}`);
  sections.push(`Current user request:\n${currentUser}`);
  return sections.join("\n\n");
}

function parseSseFrames(text) {
  const frames = [];
  let event = "message";
  let data = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      if (data.length > 0) frames.push({ event, data: data.join("\n") });
      event = "message";
      data = [];
      continue;
    }
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length > 0) frames.push({ event, data: data.join("\n") });
  return frames;
}

function rebuildDeepSeekText(state) {
  state.content = "";
  state.reasoningContent = "";
  for (const fragment of state.fragments) {
    if (!fragment) continue;
    if (fragment.type === "THINK") state.reasoningContent += fragment.content || "";
    else if (fragment.type === "RESPONSE" || fragment.type === "TEMPLATE_RESPONSE") state.content += fragment.content || "";
  }
}

function addDeepSeekFragment(state, fragment) {
  const item = { type: fragment.type, content: fragment.content || "" };
  state.fragments.push(item);
  state.currentFragmentIndex = state.fragments.length - 1;
  state.currentFragmentType = item.type;
  rebuildDeepSeekText(state);
}

function updateDeepSeekFragmentContent(state, rawIndex, value, op) {
  const index = rawIndex === -1 ? state.currentFragmentIndex : rawIndex;
  if (index == null || index < 0) return;
  const fragment = state.fragments[index] || { type: state.currentFragmentType, content: "" };
  fragment.content = op === "SET" ? (value || "") : `${fragment.content || ""}${value || ""}`;
  state.fragments[index] = fragment;
  state.currentFragmentIndex = index;
  state.currentFragmentType = fragment.type;
  rebuildDeepSeekText(state);
}

function applyDeepSeekPayload(payload, state) {
  if (payload.request_message_id) state.requestMessageId = payload.request_message_id;
  if (payload.response_message_id) state.responseMessageId = payload.response_message_id;
  if (payload.model_type) state.modelType = payload.model_type;

  const value = payload.v;
  if (value?.response?.fragments?.length) {
    for (const fragment of value.response.fragments) addDeepSeekFragment(state, fragment);
  } else if (typeof value === "string" && !payload.p) {
    updateDeepSeekFragmentContent(state, -1, value, "APPEND");
  }

  if (payload.p === "response/fragments" && Array.isArray(payload.v)) {
    for (const fragment of payload.v) addDeepSeekFragment(state, fragment);
  }

  const contentPath = typeof payload.p === "string" ? payload.p.match(/^response\/fragments\/(-?\d+)\/content$/) : null;
  if (contentPath) updateDeepSeekFragmentContent(state, Number(contentPath[1]), payload.v, payload.o);

  if (payload.p === "response" && payload.o === "BATCH" && Array.isArray(payload.v)) {
    for (const item of payload.v) {
      if (item.p === "accumulated_token_usage") state.usage.completion_tokens = item.v || 0;
    }
  }
}

export function parseDeepSeekSse(text) {
  const state = {
    content: "",
    reasoningContent: "",
    usage: {},
    requestMessageId: null,
    responseMessageId: null,
    modelType: null,
    currentFragmentType: "RESPONSE",
    currentFragmentIndex: null,
    fragments: [],
  };

  for (const frame of parseSseFrames(text)) {
    if (!frame.data || frame.data === "[DONE]") continue;
    try {
      applyDeepSeekPayload(JSON.parse(frame.data), state);
    } catch {
    }
  }

  return {
    content: state.content,
    reasoningContent: state.reasoningContent,
    usage: state.usage,
    requestMessageId: state.requestMessageId,
    responseMessageId: state.responseMessageId,
    modelType: state.modelType,
  };
}

function coerceToolValue(value) {
  const rawValue = String(value ?? "").trim();
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return rawValue.slice(1, -1).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\(["\\/bfnrt])/g, (_, ch) => ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }[ch] ?? ch));
  }
  if (rawValue === "true" || rawValue === "false") return rawValue === "true";
  if (rawValue === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) return Number(rawValue);
  return rawValue;
}

function parseParameterToolArgs(text) {
  const args = {};
  const matches = [...String(text || "").matchAll(/<parameter\s+name=["']([^"']+)["']\s*>\s*([\s\S]*?)\s*<\/parameter>/g)];
  if (matches.length === 0) return null;
  for (const match of matches) args[match[1]] = coerceToolValue(match[2]);
  return args;
}

function parseLooseToolArgs(text) {
  try {
    return JSON.parse(text);
  } catch {
  }

  const parameterArgs = parseParameterToolArgs(text);
  if (parameterArgs) return parameterArgs;

  const inner = String(text || "").trim().replace(/^\{\s*|\s*\}$/g, "");
  const keyRe = /(^|,)\s*"([^"]+)"\s*:/g;
  const matches = [...inner.matchAll(keyRe)];
  if (matches.length === 0) return null;

  const args = {};
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const key = match[2];
    const valueStart = match.index + match[0].length;
    const valueEnd = matches[i + 1]?.index ?? inner.length;
    args[key] = coerceToolValue(inner.slice(valueStart, valueEnd));
  }
  return args;
}

function parseToolJsonCandidate(text) {
  try {
    return JSON.parse(text);
  } catch {
  }

  let candidate = text;
  while (candidate.endsWith("}")) {
    candidate = candidate.slice(0, -1);
    try {
      return JSON.parse(candidate);
    } catch {
    }
  }
  return null;
}

function unpackToolArgs(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)) return parsed.args;
  if (parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)) return parsed.arguments;
  const { tool, ...args } = parsed;
  return Object.keys(args).length > 0 ? args : null;
}

const FILE_WRITE_RE = /<file-write\s*>\s*<path>\s*([\s\S]*?)\s*<\/path>\s*<content>\s*([\s\S]*?)\s*<\/(?:content|file-content)>\s*<\/file-write>/gi;

function parseFileWriteArgs(match) {
  return {
    file_path: coerceToolValue(match[1]),
    content: match[2].trim(),
  };
}

function parseFunctionStyleWriteArgs(text) {
  const match = String(text || "").match(/^Write\(,([\s\S]*?),([\s\S]*)\)$/);
  if (!match) return null;
  return {
    file_path: coerceToolValue(match[1]),
    content: match[2].trim(),
  };
}

function readJsonObject(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { json: text.slice(startIndex, i + 1), end: i + 1 };
    }
  }
  return null;
}

function findWriteJsonWrappers(text) {
  const source = String(text || "");
  const wrappers = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const writeIndex = source.indexOf("Write", searchFrom);
    if (writeIndex === -1) break;

    let cursor = writeIndex + "Write".length;
    while (/\s/.test(source[cursor] || "")) cursor += 1;
    if (source[cursor] !== "(") {
      searchFrom = writeIndex + 1;
      continue;
    }

    cursor += 1;
    while (/\s/.test(source[cursor] || "")) cursor += 1;
    if (source[cursor] !== "{") {
      searchFrom = writeIndex + 1;
      continue;
    }

    const object = readJsonObject(source, cursor);
    if (!object) break;

    let closeIndex = object.end;
    while (/\s/.test(source[closeIndex] || "")) closeIndex += 1;
    if (source[closeIndex] !== ")") {
      searchFrom = writeIndex + 1;
      continue;
    }

    const parsed = parseToolJsonCandidate(object.json);
    const args = unpackToolArgs(parsed);
    if (args) wrappers.push({ args });
    searchFrom = closeIndex + 1;
  }

  return wrappers;
}

function parseWriteJsonWrapperArgs(text) {
  return findWriteJsonWrappers(text)[0]?.args || null;
}

function buildToolCall(toolName, parsed) {
  if (typeof toolName !== "string" || typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return null;
  return {
    id: `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    type: "function",
    function: {
      name: toolName,
      arguments: JSON.stringify(parsed),
    },
  };
}

function unwrapToolText(text) {
  return String(text || "")
    .trim()
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/^\s*json\s+/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function parseToolCallText(text) {
  const unwrapped = unwrapToolText(text);
  const fileWriteMatch = [...unwrapped.matchAll(FILE_WRITE_RE)][0];
  if (fileWriteMatch) return buildToolCall("Write", parseFileWriteArgs(fileWriteMatch));
  const functionStyleWriteArgs = parseFunctionStyleWriteArgs(unwrapped);
  if (functionStyleWriteArgs) return buildToolCall("Write", functionStyleWriteArgs);
  const writeJsonWrapperArgs = parseWriteJsonWrapperArgs(unwrapped);
  if (writeJsonWrapperArgs) return buildToolCall("Write", writeJsonWrapperArgs);

  let parsed;
  let toolName;

  const jsonCandidate = unwrapped.startsWith("{")
    ? unwrapped
    : unwrapped.match(/^"tool"\s*:/)
      ? `{${unwrapped}`
      : unwrapped.match(/^tool"\s*:/)
        ? `{"${unwrapped}`
        : unwrapped;

  const parsedJson = parseToolJsonCandidate(jsonCandidate);
  if (parsedJson) {
    toolName = parsedJson?.tool;
    parsed = unpackToolArgs(parsedJson);
  } else {
    const match = unwrapped.match(/<tool(?:[-_]call)?\s+name=["']([^"']+)["']\s*>\s*([\s\S]*?)\s*<\/tool(?:[-_]call)?>/)
      || unwrapped.match(/^<?tool(?:[-_]call)?\s+name=["']([^"']+)["']\s*>\s*([\s\S]*?)(?:\s*<\/tool(?:[-_]call)?>)?$/);
    if (!match) return null;
    toolName = match[1];
    parsed = parseLooseToolArgs(match[2]);
  }

  return buildToolCall(toolName, parsed);
}

export function detectToolCalls(text) {
  const unwrapped = unwrapToolText(text);
  const fileWriteMatches = [...unwrapped.matchAll(FILE_WRITE_RE)];
  if (fileWriteMatches.length > 1) {
    return fileWriteMatches
      .map((match) => buildToolCall("Write", parseFileWriteArgs(match)))
      .filter(Boolean);
  }

  const xmlMatches = [...unwrapped.matchAll(/<tool(?:[-_]call)?\s+name=["']([^"']+)["']\s*>\s*([\s\S]*?)\s*<\/tool(?:[-_]call)?>/g)];
  if (xmlMatches.length > 1) {
    const xmlCalls = xmlMatches
      .map((match) => buildToolCall(match[1], parseLooseToolArgs(match[2])))
      .filter(Boolean);
    const allSameName = xmlCalls.every((c) => c.function.name === xmlCalls[0].function.name);
    return allSameName ? xmlCalls : [xmlCalls[0]];
  }

  const writeJsonWrappers = findWriteJsonWrappers(unwrapped);
  if (writeJsonWrappers.length > 1) {
    return writeJsonWrappers
      .map((wrapper) => buildToolCall("Write", wrapper.args))
      .filter(Boolean);
  }

  const call = parseToolCallText(unwrapped);
  return call ? [call] : [];
}

export function detectToolCall(text) {
  return detectToolCalls(text)[0] || null;
}

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function streamToText(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
  } finally {
    reader.releaseLock();
  }
}

export function resolveDeepSeekWasmPath(wasmUrl = new URL("./deepseek-pow.wasm", import.meta.url)) {
  const asString = String(wasmUrl);
  if (!asString.startsWith("file:")) return path.join(process.cwd(), "open-sse", "executors", "deepseek-pow.wasm");
  return fileURLToPath(asString);
}

let _wasmInstancePromise = null;
async function loadDeepSeekWasm() {
  if (_wasmInstancePromise) return _wasmInstancePromise;
  _wasmInstancePromise = (async () => {
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(resolveDeepSeekWasmPath());
    const { instance } = await WebAssembly.instantiate(buffer, {});
    return instance.exports;
  })();
  return _wasmInstancePromise;
}

async function defaultSolvePow(challenge) {
  const exports = await loadDeepSeekWasm();
  const memory = exports.memory;
  const addStack = exports.__wbindgen_add_to_stack_pointer;
  const malloc = exports.__wbindgen_export_0;

  const enc = new TextEncoder();
  const passString = (s) => {
    const bytes = enc.encode(s);
    const ptr = malloc(bytes.length, 1) >>> 0;
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  };

  const prefix = `${challenge.salt}_${challenge.expire_at || challenge.expireAt}_`;
  const difficulty = challenge.difficulty || 0;
  const retptr = addStack(-16);
  try {
    const [chalPtr, chalLen] = passString(challenge.challenge);
    const [prefixPtr, prefixLen] = passString(prefix);
    exports.wasm_solve(retptr, chalPtr, chalLen, prefixPtr, prefixLen, difficulty);
    const view = new DataView(memory.buffer);
    const status = view.getInt32(retptr + 0, true);
    const answer = view.getFloat64(retptr + 8, true);
    if (status === 0) throw new Error("DeepSeek PoW: no solution within difficulty range");
    return answer;
  } finally {
    addStack(16);
  }
}

async function parseJsonResponse(response, label) {
  const json = await response.json().catch(() => null);
  const code = json?.code ?? 0;
  const bizCode = json?.data?.biz_code ?? 0;
  if (!json || code !== 0 || bizCode !== 0) throw new Error(`${label} failed`);
  return json.data.biz_data;
}

export async function probeDeepSeekWebToken(apiKey, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const signal = options.signal || (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(8000) : undefined);

  try {
    const response = await fetchImpl(CHAT_SESSION_CREATE_URL, {
      method: "POST",
      headers: buildDeepSeekHeaders({ apiKey }, { referer: `${DEEPSEEK_ORIGIN}/` }),
      body: "{}",
      signal,
    });
    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: "DeepSeek auth failed — bearer token may be expired. Re-paste the token from chat.deepseek.com." };
    }
    if (!response.ok) return { valid: false, error: `DeepSeek session create failed (${response.status})` };

    const data = await parseJsonResponse(response, "DeepSeek session create").catch(() => null);
    const valid = !!data?.chat_session?.id;
    return { valid, error: valid ? null : "DeepSeek session create failed" };
  } catch (err) {
    return { valid: false, error: err.message || String(err) };
  }
}

function buildOpenAIResponse({ model, content, reasoningContent, usage, prompt }) {
  const toolCalls = detectToolCalls(content);
  const message = toolCalls.length > 0
    ? { role: "assistant", content: null, tool_calls: toolCalls }
    : { role: "assistant", content };
  if (reasoningContent && toolCalls.length === 0) message.reasoning_content = reasoningContent;

  const promptTokens = Math.ceil((prompt || "").length / 4);
  const completionTokens = usage?.completion_tokens || Math.ceil((content || "").length / 4);

  return {
    id: `chatcmpl-deepseek-web-${crypto.randomUUID().slice(0, 12)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop", logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  };
}

function looksLikeMalformedToolIntent(content, body = {}) {
  if (!Array.isArray(body.tools) || body.tools.length === 0) return false;
  const text = String(content || "");
  if (detectToolCalls(text).length > 0) return false;
  return /<\/?tool(?:[-_]call)?\b|<parameter\b|<\/invoke\b|\btool\s*[:=]|"tool"\s*:|\bargs\s*[:=]|\barguments\s*[:=]/i.test(text);
}

function buildToolRepairPrompt(content, body = {}) {
  return [
    "Your previous response looked like a tool call but was invalid.",
    "Return exactly one valid tool JSON object and no markdown, no prose.",
    '{"tool":"tool_name","args":{}}',
    "Available tools:",
    formatTools(body.tools),
    "Previous response:",
    String(content || "").slice(0, 2000),
  ].join("\n");
}

function hasDeepSeekOutput(parsed) {
  return !!String(parsed?.content || "").trim() || !!String(parsed?.reasoningContent || "").trim();
}

function buildEmptyCompletionRetryPrompt(prompt, body = {}) {
  return [
    "Your previous response was empty.",
    "Return a useful assistant response now. If a tool is needed, return exactly one valid tool JSON object and no markdown, no prose.",
    formatTools(body.tools),
    "Original prompt:",
    String(prompt || "").slice(-4000),
  ].filter(Boolean).join("\n");
}

function buildStreamingResponse(parsed, model, prompt) {
  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-deepseek-web-${crypto.randomUUID().slice(0, 12)}`;
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }] })));
      const toolCalls = detectToolCalls(parsed.content);
      if (toolCalls.length > 0) {
        controller.enqueue(encoder.encode(sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: toolCalls.map((toolCall, index) => ({ index, id: toolCall.id, type: "function", function: { name: toolCall.function.name, arguments: toolCall.function.arguments } })) }, finish_reason: null, logprobs: null }] })));
        controller.enqueue(encoder.encode(sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls", logprobs: null }] })));
      } else {
        if (parsed.reasoningContent) controller.enqueue(encoder.encode(sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { reasoning_content: parsed.reasoningContent }, finish_reason: null, logprobs: null }] })));
        if (parsed.content) controller.enqueue(encoder.encode(sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: parsed.content }, finish_reason: null, logprobs: null }] })));
        controller.enqueue(encoder.encode(sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }] })));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

export class DeepSeekWebExecutor extends BaseExecutor {
  constructor(options = {}) {
    super("deepseek-web", PROVIDERS["deepseek-web"]);
    this.solvePow = options.solvePow || defaultSolvePow;
    this.sessionTtlMs = options.sessionTtlMs || DEFAULT_SESSION_TTL_MS;
    this.sessionCache = new Map();
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({ error: { message: "Missing or empty messages array", type: "invalid_request" } }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: CHAT_COMPLETION_URL, headers: {}, transformedBody: body };
    }

    const token = credentials?.accessToken || credentials?.apiKey;
    if (!token) {
      const errResp = new Response(JSON.stringify({ error: { message: "DeepSeek Web bearer token is required", type: "invalid_request" } }), { status: 401, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: CHAT_COMPLETION_URL, headers: {}, transformedBody: body };
    }

    const prompt = buildDeepSeekPrompt(body);
    if (!prompt.trim()) {
      const errResp = new Response(JSON.stringify({ error: { message: "Empty prompt after processing", type: "invalid_request" } }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: CHAT_COMPLETION_URL, headers: {}, transformedBody: body };
    }

    const baseHeaders = buildDeepSeekHeaders(credentials, { referer: `${DEEPSEEK_ORIGIN}/` });

    try {
      const chatSessionId = await getChatSessionId({
        model,
        body,
        credentials,
        headers: baseHeaders,
        signal,
        sessionTtlMs: this.sessionTtlMs,
        sessionCache: this.sessionCache,
      });
      if (chatSessionId?.errorStatus) return this.errorResponse(chatSessionId.errorStatus, "DeepSeek session create failed", baseHeaders, body);

      const powResponse = await fetch(CREATE_POW_CHALLENGE_URL, { method: "POST", headers: baseHeaders, body: JSON.stringify({ target_path: CHAT_COMPLETION_PATH }), signal });
      if (!powResponse.ok) return this.errorResponse(powResponse.status, "DeepSeek PoW challenge failed", baseHeaders, body);
      const powData = await parseJsonResponse(powResponse, "DeepSeek PoW challenge");
      const challenge = powData.challenge;
      const answer = await this.solvePow(challenge);
      const powHeader = buildPowHeaderValue({ ...challenge, answer, target_path: CHAT_COMPLETION_PATH });
      const headers = buildDeepSeekHeaders(credentials, { powHeader, referer: `${DEEPSEEK_ORIGIN}/a/chat/s/${chatSessionId}` });
      const flags = mapDeepSeekModel(model, body);
      const finalBody = {
        chat_session_id: chatSessionId,
        parent_message_id: null,
        model_type: flags.modelType,
        prompt,
        ref_file_ids: [],
        thinking_enabled: flags.thinkingEnabled,
        search_enabled: flags.searchEnabled,
        preempt: false,
      };

      log?.info?.("DEEPSEEK-WEB", `Query to ${model}, len=${prompt.length}`);
      let requestBody = finalBody;
      let completionResponse = await fetch(CHAT_COMPLETION_URL, { method: "POST", headers, body: JSON.stringify(requestBody), signal });
      if (!completionResponse.ok) return this.errorResponse(completionResponse.status, "DeepSeek completion failed", headers, requestBody);
      if (!completionResponse.body) return this.errorResponse(502, "DeepSeek returned empty response body", headers, requestBody);

      let parsed = parseDeepSeekSse(await streamToText(completionResponse.body));
      if (looksLikeMalformedToolIntent(parsed.content, body)) {
        requestBody = { ...finalBody, prompt: buildToolRepairPrompt(parsed.content, body) };
        completionResponse = await fetch(CHAT_COMPLETION_URL, { method: "POST", headers, body: JSON.stringify(requestBody), signal });
        if (!completionResponse.ok) return this.errorResponse(completionResponse.status, "DeepSeek completion failed", headers, requestBody);
        if (!completionResponse.body) return this.errorResponse(502, "DeepSeek returned empty response body", headers, requestBody);
        parsed = parseDeepSeekSse(await streamToText(completionResponse.body));
      }

      if (!hasDeepSeekOutput(parsed)) {
        requestBody = { ...finalBody, prompt: buildEmptyCompletionRetryPrompt(requestBody.prompt, body) };
        completionResponse = await fetch(CHAT_COMPLETION_URL, { method: "POST", headers, body: JSON.stringify(requestBody), signal });
        if (!completionResponse.ok) return this.errorResponse(completionResponse.status, "DeepSeek completion failed", headers, requestBody);
        if (!completionResponse.body) return this.errorResponse(502, "DeepSeek returned empty response body", headers, requestBody);
        parsed = parseDeepSeekSse(await streamToText(completionResponse.body));
        if (!hasDeepSeekOutput(parsed)) return this.errorResponse(502, "DeepSeek returned empty completion", headers, requestBody);
      }

      const response = stream
        ? new Response(buildStreamingResponse(parsed, model, requestBody.prompt), { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } })
        : new Response(JSON.stringify(buildOpenAIResponse({ model, prompt: requestBody.prompt, ...parsed })), { status: 200, headers: { "Content-Type": "application/json" } });

      return { response, url: CHAT_COMPLETION_URL, headers, transformedBody: requestBody };
    } catch (err) {
      log?.error?.("DEEPSEEK-WEB", err.message || String(err));
      const errResp = new Response(JSON.stringify({ error: { message: `DeepSeek Web failed: ${err.message || String(err)}`, type: "upstream_error" } }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: CHAT_COMPLETION_URL, headers: baseHeaders, transformedBody: body };
    }
  }

  errorResponse(status, message, headers, transformedBody) {
    let errMsg = message;
    if (status === 401 || status === 403) errMsg = "DeepSeek auth failed — bearer token may be expired. Re-paste the token from chat.deepseek.com.";
    else if (status === 429) errMsg = "DeepSeek rate limited. Wait a moment and retry.";
    const response = new Response(JSON.stringify({ error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` } }), { status, headers: { "Content-Type": "application/json" } });
    return { response, url: CHAT_COMPLETION_URL, headers, transformedBody };
  }
}

export default DeepSeekWebExecutor;
