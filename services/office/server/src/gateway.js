// 9router is the only AI backend: every agent turn is an OpenAI-compatible
// chat completion against the gateway, which handles provider routing,
// combos, account rotation and fallback.
import { config } from "./config.js";

export class GatewayError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createGateway({ baseUrl = config.gateway.baseUrl, apiKey = config.gateway.apiKey, timeoutMs = config.gateway.timeoutMs, fetchImpl = fetch } = {}) {
  const headers = () => ({
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  });

  async function request(path, { method = "GET", body, signal } = {}) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const msg = json?.error?.message || json?.error || text.slice(0, 300) || res.statusText;
      throw new GatewayError(`Gateway ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, res.status);
    }
    return json;
  }

  return {
    baseUrl,

    /** One non-streaming chat turn. Returns the assistant message ({ content, tool_calls }). */
    async chat({ model, messages, tools, signal }) {
      if (!model) throw new GatewayError("No model configured for this agent (set one on the agent or DEFAULT_MODEL)", 400);
      const body = { model, messages, stream: false };
      if (tools?.length) {
        body.tools = tools;
        body.tool_choice = "auto";
      }
      const json = await request("/chat/completions", { method: "POST", body, signal });
      const choice = json?.choices?.[0];
      if (!choice?.message) throw new GatewayError("Gateway returned no choices", 502);
      return { message: choice.message, finishReason: choice.finish_reason, usage: json.usage || null };
    },

    async listModels() {
      const json = await request("/models");
      return (json?.data || []).map((m) => ({ id: m.id, owned_by: m.owned_by || "" }));
    },
  };
}
