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

    /**
     * What the office can use right now: reachability, key validity, models
     * grouped by provider prefix, and combos (ids without a provider prefix).
     */
    async status({ defaultModel = "" } = {}) {
      const started = Date.now();
      try {
        const models = await this.listModels();
        const providers = new Map();
        const combos = [];
        for (const m of models) {
          const slash = m.id.indexOf("/");
          if (slash === -1) { combos.push(m.id); continue; }
          const prefix = m.id.slice(0, slash);
          if (!providers.has(prefix)) providers.set(prefix, []);
          providers.get(prefix).push(m.id);
        }
        return {
          ok: true,
          baseUrl,
          authenticated: !!apiKey,
          latencyMs: Date.now() - started,
          modelCount: models.length,
          providers: [...providers].map(([prefix, ids]) => ({ prefix, models: ids })).sort((a, b) => b.models.length - a.models.length || a.prefix.localeCompare(b.prefix)),
          combos: combos.sort(),
          defaultModel,
          defaultModelAvailable: !defaultModel || models.some((m) => m.id === defaultModel),
        };
      } catch (err) {
        return {
          ok: false, baseUrl, authenticated: !!apiKey, latencyMs: Date.now() - started, error: err.message,
          status: err.status || 0, modelCount: 0, providers: [], combos: [], defaultModel, defaultModelAvailable: false,
        };
      }
    },

    /** Send a tiny prompt to a model; reports latency and the reply or error. */
    async ping(model) {
      const started = Date.now();
      try {
        const { message } = await this.chat({ model, messages: [{ role: "user", content: "Reply with the single word: ready" }] });
        return { ok: true, model, latencyMs: Date.now() - started, reply: String(message.content || "").trim().slice(0, 200) };
      } catch (err) {
        return { ok: false, model, latencyMs: Date.now() - started, error: err.message };
      }
    },
  };
}
