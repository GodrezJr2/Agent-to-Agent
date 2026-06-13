import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { KIRO_AGENTIC_SYSTEM_PROMPT } from "../config/kiroConstants.js";

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
const DEEPSEEK_AGENTIC_SUFFIX = "-agentic";

// Rotate the upstream DeepSeek session after this many messages have
// accumulated on it. Chaining keeps the full history server-side, so without
// rotation context grows unbounded and DeepSeek collapses to empty completions
// past ~90k tokens. ~40 messages keeps a comfortable margin under the limit.
const DEFAULT_SESSION_ROTATE_AFTER_MESSAGES = 40;

// Live-stream keepalive: while buffering the response phase (after thinking
// ends) emit an invisible zero-width reasoning delta every HEARTBEAT_MS so the
// client's idle/TTFT timeout never fires. Empty OpenAI deltas are dropped by the
// OpenAI->Claude translator, so the heartbeat must be real reasoning text.
const HEARTBEAT_MS = 5000;
const HEARTBEAT_TOKEN = String.fromCharCode(0x200b);

function stripProviderPrefix(model) {
  return String(model || "instant").replace(/^deepseek-web\//, "");
}

function isAgenticModel(key) {
  return key.endsWith(DEEPSEEK_AGENTIC_SUFFIX);
}

function stripAgenticSuffix(key) {
  return isAgenticModel(key) ? key.slice(0, -DEEPSEEK_AGENTIC_SUFFIX.length) : key;
}

function getSessionCacheKey(model, credentials = {}) {
  return `${credentials.connectionId || credentials.connectionName || "default"}:${stripProviderPrefix(model)}`;
}

function getMessageCount(body = {}) {
  return Array.isArray(body.messages) ? body.messages.length : 0;
}

async function getChatSession({ model, body, credentials, headers, signal, sessionTtlMs, sessionRotateAfter, sessionCache }) {
  const now = Date.now();
  const key = getSessionCacheKey(model, credentials);
  const messageCount = getMessageCount(body);
  const cached = sessionCache.get(key);
  // Rotate the DeepSeek session once it has carried enough turns. We chain via
  // parent_message_id, so the upstream session keeps the WHOLE history — it
  // grows unbounded and DeepSeek degrades to near-empty completions past ~90k
  // tokens. Rotating starts a fresh session and resends the full prompt once
  // (resetting upstream context); deltas resume from there. Keeps context bounded.
  const turnsOnSession = cached ? messageCount - (cached.baseMessageCount ?? 0) : 0;
  const withinRotateWindow = turnsOnSession < sessionRotateAfter;
  const canReuse = cached
    && now - cached.updatedAt < sessionTtlMs
    && messageCount >= cached.messageCount
    && withinRotateWindow;

  if (canReuse) {
    // Touch TTL but DO NOT advance messageCount/parentMessageId yet — only on a
    // successful completion (see rememberSession). Keeps delta + chain correct
    // if this request fails or is retried.
    cached.updatedAt = now;
    return {
      key,
      chatSessionId: cached.chatSessionId,
      reused: true,
      prevMessageCount: cached.messageCount,
      parentMessageId: cached.parentMessageId ?? null,
    };
  }

  const response = await fetch(CHAT_SESSION_CREATE_URL, { method: "POST", headers, body: "{}", signal });
  if (!response.ok) return { errorStatus: response.status };
  const data = await parseJsonResponse(response, "DeepSeek session create");
  const chatSessionId = data.chat_session?.id;
  if (!chatSessionId) throw new Error("DeepSeek session response missing chat_session.id");

  sessionCache.set(key, { chatSessionId, messageCount: 0, baseMessageCount: messageCount, updatedAt: now, parentMessageId: null });
  return { key, chatSessionId, reused: false, prevMessageCount: 0, parentMessageId: null };
}

export function mapDeepSeekModel(model, body = {}) {
  const raw = stripProviderPrefix(model);
  const agentic = isAgenticModel(raw);
  const key = agentic ? stripAgenticSuffix(raw) : raw;
  const mapped = MODEL_FLAGS[key] || MODEL_FLAGS.instant;
  const thinkingRequested = body?.thinking === true || body?.thinking?.type === "enabled" || (body?.reasoning_effort != null && body.reasoning_effort !== "none");
  const modelExplicitlyDisablesThinking = key === "instant" || key === "instant-search" || key === "expert" || key === "expert-search";

  return {
    modelType: mapped.modelType,
    thinkingEnabled: mapped.thinkingEnabled || (thinkingRequested && !modelExplicitlyDisablesThinking) || thinkingRequested,
    searchEnabled: mapped.searchEnabled,
    agentic,
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

// Short recency anchor re-stated at the END of every prompt. LLMs weight the
// last tokens most, so in long sessions the tool-call contract must sit next to
// the generation point — not only in the far-away Instructions header.
function buildToolReminder(body = {}, { agentic = false } = {}) {
  if (!Array.isArray(body.tools) || body.tools.length === 0) return "";
  const names = body.tools
    .map((tool) => tool?.function?.name || tool?.name)
    .filter(Boolean)
    .join(", ");
  const lines = [
    "Reminder: to act, respond with EXACTLY ONE JSON tool call and nothing else:",
    '{"tool":"tool_name","args":{}}',
    names ? `Available tools: ${names}` : "",
    "One tool per response. If the task is fully complete, answer normally instead.",
  ];
  if (agentic) {
    // The full chunked-write protocol is only injected on turn 1 (see
    // buildPromptForSession). On delta turns it has decayed out of focus, so
    // re-state the one rule that actually breaks things: a single oversized
    // Write gets truncated mid-output and the whole tool call fails.
    lines.push(
      "For any file over ~300 lines, do NOT inline the whole file in one Write — oversized writes get truncated mid-output and the call fails. Write the first ~250-line chunk, then append the rest with follow-up edits in later turns.",
    );
  }
  return lines.filter(Boolean).join("\n");
}

// Build a DELTA prompt for a reused DeepSeek session: send only what is new
// since the last turn (tool results, new user input). Assistant turns are
// skipped — DeepSeek already holds its own prior outputs in the session, so
// re-sending them just doubles the history and dilutes the instructions.
export function buildDeepSeekDeltaPrompt(deltaMessages = [], body = {}, { agentic = false } = {}) {
  const parts = [];
  for (const message of deltaMessages) {
    const role = message.role === "developer" ? "system" : message.role;
    if (role === "assistant") continue;

    const text = contentToText(message.content).trim();
    if (role === "tool") {
      const truncated = text.length > 800 ? text.slice(0, 800) + "...(truncated)" : text;
      parts.push(`tool ${message.name || message.tool_call_id || "result"}: ${truncated}`);
    } else if (role === "user") {
      if (text) parts.push(`user: ${text}`);
    } else if (role === "system") {
      if (text) parts.push(text);
    }
  }

  const sections = [];
  if (parts.length) sections.push(parts.join("\n"));
  const reminder = buildToolReminder(body, { agentic });
  if (reminder) sections.push(reminder);
  return sections.join("\n\n");
}

export function buildDeepSeekPrompt(body = {}, { agentic = false } = {}) {
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
  const reminder = buildToolReminder(body, { agentic });
  if (reminder) sections.push(reminder);
  return sections.join("\n\n");
}

// Pick the right prompt for this turn: a small delta for a reused session,
// otherwise the full prompt (first contact, or empty delta fallback). The
// `-agentic` chunked-write system prompt is injected only on the full path —
// reused sessions already carry it from turn 1.
function buildPromptForSession({ body, flags, reused, prevMessageCount }) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (reused) {
    const delta = messages.slice(prevMessageCount);
    const deltaPrompt = buildDeepSeekDeltaPrompt(delta, body, { agentic: flags.agentic });
    if (deltaPrompt.trim()) return deltaPrompt;
  }
  let promptBody = body;
  if (flags.agentic) {
    promptBody = { ...body, messages: [{ role: "system", content: KIRO_AGENTIC_SYSTEM_PROMPT }, ...messages] };
  }
  return buildDeepSeekPrompt(promptBody, { agentic: flags.agentic });
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

function createDeepSeekState() {
  return {
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
}

function summarizeDeepSeekState(state) {
  return {
    content: state.content,
    reasoningContent: state.reasoningContent,
    usage: state.usage,
    requestMessageId: state.requestMessageId,
    responseMessageId: state.responseMessageId,
    modelType: state.modelType,
  };
}

function frameToPayload(frameText) {
  if (!frameText) return null;
  const dataLines = [];
  for (const rawLine of frameText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  const data = dataLines.join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Read a DeepSeek completion stream incrementally, applying each SSE frame to
// `state` as it arrives and invoking onPayload after each. Lets the caller emit
// reasoning deltas live (keepalive) instead of buffering the whole response.
async function streamDeepSeekFragments(responseBody, onPayload) {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const payload = frameToPayload(part);
        if (payload) await onPayload(payload);
      }
    }
    buffer += decoder.decode();
    for (const part of buffer.split(/\r?\n\r?\n/)) {
      const payload = frameToPayload(part);
      if (payload) await onPayload(payload);
    }
  } finally {
    reader.releaseLock();
  }
}

// Consume one completion stream, streaming THINK fragments out via onReasoning
// as they grow, and return the same summary shape as parseDeepSeekSse.
async function consumeCompletionStream(responseBody, onReasoning) {
  const state = createDeepSeekState();
  let emittedReasoningLen = 0;
  await streamDeepSeekFragments(responseBody, (payload) => {
    applyDeepSeekPayload(payload, state);
    if (state.reasoningContent.length > emittedReasoningLen) {
      onReasoning?.(state.reasoningContent.slice(emittedReasoningLen));
      emittedReasoningLen = state.reasoningContent.length;
    }
  });
  return summarizeDeepSeekState(state);
}

export function parseDeepSeekSse(text) {
  const state = createDeepSeekState();

  for (const frame of parseSseFrames(text)) {
    if (!frame.data || frame.data === "[DONE]") continue;
    try {
      applyDeepSeekPayload(JSON.parse(frame.data), state);
    } catch {
    }
  }

  return summarizeDeepSeekState(state);
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

// Args given as direct child tags instead of <parameter name=...>, e.g.
//   <tool_call name="Write"><file_path>a.html</file_path><content>...</content></tool_call>
// `content`/`file-content` may hold HTML (angle brackets), so they are grabbed
// greedily up to their close tag; other tags are treated as scalars (no nested
// markup) so we don't misread surrounding HTML as args.
function parseChildTagArgs(text) {
  const source = String(text || "");
  const args = {};

  // Pull the content/file-content block out first (it may hold HTML), then scan
  // the REMAINDER for scalar tags — otherwise tags inside the HTML body (e.g.
  // <title>...</title>) get misread as tool args.
  let scanSource = source;
  const contentMatch = source.match(/<(content|file-content)>\s*([\s\S]*?)\s*<\/(?:content|file-content)>/i);
  if (contentMatch) {
    args.content = contentMatch[2];
    scanSource = source.slice(0, contentMatch.index) + source.slice(contentMatch.index + contentMatch[0].length);
  }

  const scalarMatches = [...scanSource.matchAll(/<([a-zA-Z_][\w-]*)>\s*([^<>]*?)\s*<\/\1>/g)];
  for (const match of scalarMatches) {
    const key = match[1];
    if (key === "content" || key === "file-content") continue;
    if (key === "path") {
      if (!("file_path" in args)) args.file_path = coerceToolValue(match[2]);
      continue;
    }
    if (!(key in args)) args[key] = coerceToolValue(match[2]);
  }

  return Object.keys(args).length > 0 ? args : null;
}

function parseLooseToolArgs(text) {
  try {
    return JSON.parse(text);
  } catch {
  }

  const parameterArgs = parseParameterToolArgs(text);
  if (parameterArgs) return parameterArgs;

  const childTagArgs = parseChildTagArgs(text);
  if (childTagArgs) return childTagArgs;

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

function isToolObject(parsed) {
  return !!parsed && typeof parsed === "object" && !Array.isArray(parsed)
    && (typeof parsed.tool === "string" || parsed.args != null || parsed.arguments != null);
}

// Find a tool-call JSON object embedded inside prose. DeepSeek frequently
// ignores "respond with ONLY JSON" and writes a sentence first, then the call
// in a fenced ```json block, e.g.:
//   I'll use the X skill.
//   ```json
//   {"tool":"Skill","args":{...}}
//   ```
// unwrapToolText only strips a fence at the very start/end, so these slip
// through and get misclassified as a malformed tool intent.
function findEmbeddedToolObject(text) {
  const source = String(text || "");

  const fence = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const parsed = parseToolJsonCandidate(fence[1].trim());
    if (isToolObject(parsed)) return parsed;
  }

  let index = source.indexOf("{");
  while (index !== -1) {
    const object = readJsonObject(source, index);
    if (object) {
      const parsed = parseToolJsonCandidate(object.json);
      if (isToolObject(parsed)) return parsed;
      index = source.indexOf("{", object.end);
    } else {
      index = source.indexOf("{", index + 1);
    }
  }
  return null;
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

  let parsedJson = parseToolJsonCandidate(jsonCandidate);
  if (!parsedJson) parsedJson = findEmbeddedToolObject(unwrapped);
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

export class DeepSeekWebExecutor extends BaseExecutor {
  constructor(options = {}) {
    super("deepseek-web", PROVIDERS["deepseek-web"]);
    this.solvePow = options.solvePow || defaultSolvePow;
    this.sessionTtlMs = options.sessionTtlMs || DEFAULT_SESSION_TTL_MS;
    this.sessionRotateAfter = options.sessionRotateAfter || DEFAULT_SESSION_ROTATE_AFTER_MESSAGES;
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

    const flags = mapDeepSeekModel(model, body);
    const baseHeaders = buildDeepSeekHeaders(credentials, { referer: `${DEEPSEEK_ORIGIN}/` });

    try {
      const session = await getChatSession({
        model,
        body,
        credentials,
        headers: baseHeaders,
        signal,
        sessionTtlMs: this.sessionTtlMs,
        sessionRotateAfter: this.sessionRotateAfter,
        sessionCache: this.sessionCache,
      });
      if (session?.errorStatus) return this.errorResponse(session.errorStatus, "DeepSeek session create failed", baseHeaders, body);

      const { key: sessionCacheKey, chatSessionId, reused, prevMessageCount, parentMessageId } = session;
      const prompt = buildPromptForSession({ body, flags, reused, prevMessageCount });
      if (!prompt.trim()) {
        const errResp = new Response(JSON.stringify({ error: { message: "Empty prompt after processing", type: "invalid_request" } }), { status: 400, headers: { "Content-Type": "application/json" } });
        return { response: errResp, url: CHAT_COMPLETION_URL, headers: baseHeaders, transformedBody: body };
      }

      const powResponse = await fetch(CREATE_POW_CHALLENGE_URL, { method: "POST", headers: baseHeaders, body: JSON.stringify({ target_path: CHAT_COMPLETION_PATH }), signal });
      if (!powResponse.ok) return this.errorResponse(powResponse.status, "DeepSeek PoW challenge failed", baseHeaders, body);
      const powData = await parseJsonResponse(powResponse, "DeepSeek PoW challenge");
      const challenge = powData.challenge;
      const answer = await this.solvePow(challenge);
      const powHeader = buildPowHeaderValue({ ...challenge, answer, target_path: CHAT_COMPLETION_PATH });
      const headers = buildDeepSeekHeaders(credentials, { powHeader, referer: `${DEEPSEEK_ORIGIN}/a/chat/s/${chatSessionId}` });
      const finalBody = {
        chat_session_id: chatSessionId,
        parent_message_id: reused ? parentMessageId : null,
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

      if (stream) {
        // Stream live: forward DeepSeek thinking as it arrives so the client
        // sees bytes within ~1-2s. Buffering the whole response (incl. long
        // thinking) before the first byte is what tripped the client's
        // time-to-first-token timeout and caused the retry loop. Tool detection
        // still needs the full response text, so the response phase is buffered
        // behind a zero-width reasoning heartbeat; chaining/retries happen
        // inside the stream (see buildLiveStream).
        const liveStream = this.buildLiveStream({ firstResponse: completionResponse, finalBody, headers, body, model, signal, sessionCacheKey });
        const response = new Response(liveStream, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } });
        return { response, url: CHAT_COMPLETION_URL, headers, transformedBody: finalBody };
      }

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

      // Success: advance the chain. Only now do we record the new messageCount
      // and chain the next turn to THIS response. Failed/retried attempts above
      // never reach here, so their (bad) sibling messages stay off the path.
      this.rememberSession(sessionCacheKey, body, parsed);

      const response = new Response(JSON.stringify(buildOpenAIResponse({ model, prompt: requestBody.prompt, ...parsed })), { status: 200, headers: { "Content-Type": "application/json" } });
      return { response, url: CHAT_COMPLETION_URL, headers, transformedBody: requestBody };
    } catch (err) {
      log?.error?.("DEEPSEEK-WEB", err.message || String(err));
      const errResp = new Response(JSON.stringify({ error: { message: `DeepSeek Web failed: ${err.message || String(err)}`, type: "upstream_error" } }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: CHAT_COMPLETION_URL, headers: baseHeaders, transformedBody: body };
    }
  }

  rememberSession(key, body, parsed) {
    const entry = this.sessionCache.get(key);
    if (!entry) return;
    entry.messageCount = getMessageCount(body);
    entry.updatedAt = Date.now();
    if (parsed?.responseMessageId != null) entry.parentMessageId = parsed.responseMessageId;
  }

  buildLiveStream({ firstResponse, finalBody, headers, body, model, signal, sessionCacheKey }) {
    const self = this;
    let heartbeat = null;
    let alive = true;
    const stopHeartbeat = () => {
      alive = false;
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    };

    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const created = Math.floor(Date.now() / 1000);
        const id = `chatcmpl-deepseek-web-${crypto.randomUUID().slice(0, 12)}`;
        const emit = (delta, finishReason = null) => {
          try {
            controller.enqueue(encoder.encode(sseChunk({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }] })));
          } catch {
          }
        };
        const emitReasoning = (text) => { if (text) emit({ reasoning_content: text }); };
        const done = () => {
          try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { }
          try { controller.close(); } catch { }
        };

        emit({ role: "assistant" });
        heartbeat = setInterval(() => { if (alive) emitReasoning(HEARTBEAT_TOKEN); }, HEARTBEAT_MS);

        try {
          let requestBody = finalBody;
          let summary = await consumeCompletionStream(firstResponse.body, emitReasoning);

          if (looksLikeMalformedToolIntent(summary.content, body)) {
            requestBody = { ...finalBody, prompt: buildToolRepairPrompt(summary.content, body) };
            const repair = await fetch(CHAT_COMPLETION_URL, { method: "POST", headers, body: JSON.stringify(requestBody), signal });
            if (repair.ok && repair.body) summary = await consumeCompletionStream(repair.body, emitReasoning);
          }

          if (!hasDeepSeekOutput(summary)) {
            requestBody = { ...finalBody, prompt: buildEmptyCompletionRetryPrompt(requestBody.prompt, body) };
            const retry = await fetch(CHAT_COMPLETION_URL, { method: "POST", headers, body: JSON.stringify(requestBody), signal });
            if (retry.ok && retry.body) summary = await consumeCompletionStream(retry.body, emitReasoning);
          }

          stopHeartbeat();

          if (hasDeepSeekOutput(summary)) self.rememberSession(sessionCacheKey, body, summary);

          const toolCalls = detectToolCalls(summary.content);
          if (toolCalls.length > 0) {
            emit({ tool_calls: toolCalls.map((toolCall, index) => ({ index, id: toolCall.id, type: "function", function: { name: toolCall.function.name, arguments: toolCall.function.arguments } })) });
            emit({}, "tool_calls");
          } else if (summary.content) {
            emit({ content: summary.content }, "stop");
          } else {
            emit({ content: "[DeepSeek Web returned an empty completion]" }, "stop");
          }
          done();
        } catch (err) {
          stopHeartbeat();
          emit({ content: `[DeepSeek Web error: ${err?.message || String(err)}]` }, "stop");
          done();
        }
      },
      cancel() {
        stopHeartbeat();
      },
    });
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
