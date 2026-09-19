import path from "node:path";

const env = process.env;

export const config = {
  port: Number(env.PORT) || 3100,
  host: env.HOST || "0.0.0.0",
  // Public base URL other agents use to reach this office's A2A endpoints.
  // Agent cards advertise `${publicUrl}/a2a/<agentId>/`.
  publicUrl: (env.PUBLIC_URL || `http://localhost:${Number(env.PORT) || 3100}`).replace(/\/+$/, ""),
  // Loopback URL this process uses to call its own agents over A2A.
  selfUrl: (env.SELF_URL || `http://127.0.0.1:${Number(env.PORT) || 3100}`).replace(/\/+$/, ""),
  gateway: {
    // 9router's OpenAI-compatible endpoint; every agent thinks through it.
    baseUrl: (env.GATEWAY_URL || "http://localhost:20128/v1").replace(/\/+$/, ""),
    apiKey: env.GATEWAY_API_KEY || "",
    defaultModel: env.DEFAULT_MODEL || "",
    timeoutMs: Number(env.GATEWAY_TIMEOUT_MS) || 10 * 60 * 1000,
  },
  dataDir: path.resolve(env.DATA_DIR || "./data"),
  workspacesDir: path.resolve(env.WORKSPACES_DIR || "./data/workspaces"),
  agent: {
    maxSteps: Number(env.AGENT_MAX_STEPS) || 25,
    maxDelegationDepth: Number(env.AGENT_MAX_DELEGATION_DEPTH) || 4,
    bashTimeoutMs: Number(env.BASH_TIMEOUT_MS) || 60 * 1000,
    toolOutputLimit: Number(env.TOOL_OUTPUT_LIMIT) || 12000,
  },
  // Optional shared secret. When set, the dashboard API and every A2A endpoint
  // require `Authorization: Bearer <OFFICE_API_KEY>`; agent cards stay public.
  apiKey: env.OFFICE_API_KEY || "",
};
