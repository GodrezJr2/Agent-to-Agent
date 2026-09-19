// A2A v1 plumbing: every local office agent is a real A2A server (own agent
// card + JSON-RPC endpoint at /a2a/<agentId>/), and every delegation is a real
// A2A client call, so local and remote agents are interchangeable.
import express from "express";
import { AGENT_CARD_PATH, A2A_PROTOCOL_VERSION, Role, Task, TaskState } from "@a2a-js/sdk";
import { DefaultRequestHandler } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import { ClientFactory } from "@a2a-js/sdk/client";
import { config } from "./config.js";
import { TOOL_DEFINITIONS } from "./tools.js";

export { Role, TaskState };

export const textPart = (value) => ({ content: { $case: "text", value: String(value) }, metadata: undefined, filename: "", mediaType: "text/plain" });

export function partsToText(parts = []) {
  return parts
    .map((p) => {
      const c = p?.content;
      if (!c) return "";
      if (c.$case === "text") return c.value;
      if (c.$case === "data") return JSON.stringify(c.value);
      if (c.$case === "url") return `[file: ${p.filename || c.value}](${c.value})`;
      if (c.$case === "raw") return `[binary file: ${p.filename || "attachment"}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function agentMessage({ text, taskId = "", contextId = "", metadata = {} }) {
  return { role: Role.ROLE_AGENT, messageId: crypto.randomUUID(), parts: [textPart(text)], taskId, contextId, metadata, extensions: [], referenceTaskIds: [] };
}

export function userMessage({ text, contextId = "", taskId = "", metadata = {} }) {
  return { role: Role.ROLE_USER, messageId: crypto.randomUUID(), parts: [textPart(text)], taskId, contextId, metadata, extensions: [], referenceTaskIds: [] };
}

export const agentBaseUrl = (agentId, base = config.publicUrl) => `${base}/a2a/${agentId}/`;

/** A2A TaskStore backed by the office SQLite db, scoped to one agent. */
export class SqliteTaskStore {
  constructor(db, agentId) {
    this.db = db;
    this.agentId = agentId;
  }

  async save(task) {
    this.db.saveTask(this.agentId, task, JSON.stringify(Task.toJSON(task)));
  }

  async load(taskId) {
    const json = this.db.loadTaskJson(this.agentId, taskId);
    return json ? Task.fromJSON(JSON.parse(json)) : undefined;
  }

  async list(params = {}) {
    const pageSize = Math.min(Math.max(Number(params.pageSize) || 50, 1), 100);
    const offset = Number(params.pageToken) || 0;
    const { total, rows } = this.db.listTaskJson(this.agentId, {
      contextId: params.contextId || "",
      state: params.status || 0,
      limit: pageSize,
      offset,
    });
    const tasks = rows.map((json) => {
      const task = Task.fromJSON(JSON.parse(json));
      if (params.includeArtifacts === false) task.artifacts = [];
      if (params.historyLength !== undefined) task.history = params.historyLength > 0 ? task.history.slice(-params.historyLength) : [];
      return task;
    });
    const next = offset + rows.length;
    return { tasks, nextPageToken: next < total ? String(next) : "", pageSize, totalSize: total };
  }
}

export function buildAgentCard(agent, office, { baseUrl = config.publicUrl } = {}) {
  const tools = (agent.tools?.length ? agent.tools : Object.keys(TOOL_DEFINITIONS)).filter((t) => TOOL_DEFINITIONS[t]);
  return {
    name: agent.name,
    description: agent.description || `${agent.role || "Agent"} in the ${office?.name || "A2A"} office.`,
    version: "1.0.0",
    supportedInterfaces: [{ url: agentBaseUrl(agent.id, baseUrl), protocolBinding: "JSONRPC", tenant: "", protocolVersion: A2A_PROTOCOL_VERSION }],
    provider: { organization: office?.name || "A2A Office", url: baseUrl },
    capabilities: { streaming: true, pushNotifications: false, extensions: [], extendedAgentCard: false },
    securitySchemes: config.apiKey ? { bearer: { scheme: { $case: "httpAuthSecurityScheme", value: { scheme: "bearer", bearerFormat: "", description: "OFFICE_API_KEY" } } } } : {},
    securityRequirements: config.apiKey ? [{ schemes: { bearer: { list: [] } } }] : [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [{
      id: `${agent.id}-main`,
      name: agent.role || agent.name,
      description: agent.description || `Handles tasks as ${agent.role || agent.name}. Tools: ${tools.join(", ")}.`,
      tags: [agent.role || "agent", ...tools.slice(0, 6)],
      examples: [],
      inputModes: ["text/plain"],
      outputModes: ["text/plain"],
      securityRequirements: [],
    }],
    documentationUrl: "",
    signatures: [],
  };
}

/**
 * Hosts one A2A server per local agent under /a2a/:agentId. Handlers are built
 * lazily and rebuilt when the agent changes (the card is baked into them).
 */
export function createAgentHost({ db, createExecutor, baseUrl = config.publicUrl }) {
  const cache = new Map();

  function routerFor(agentId) {
    const hit = cache.get(agentId);
    if (hit) return hit;
    const agent = db.getAgent(agentId);
    if (!agent || agent.kind !== "local") return null;
    const office = db.getOffice(agent.officeId);
    const handler = new DefaultRequestHandler(buildAgentCard(agent, office, { baseUrl }), new SqliteTaskStore(db, agentId), createExecutor(agentId));
    const router = express.Router();
    router.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: handler }));
    router.use(jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
    cache.set(agentId, router);
    return router;
  }

  const mount = express.Router();
  mount.use("/:agentId", (req, res, next) => {
    const router = routerFor(req.params.agentId);
    if (!router) return res.status(404).json({ error: "Unknown agent" });
    return router(req, res, next);
  });

  return {
    router: mount,
    invalidate: (agentId) => cache.delete(agentId),
    card: (agentId) => {
      const agent = db.getAgent(agentId);
      return agent ? buildAgentCard(agent, db.getOffice(agent.officeId), { baseUrl }) : null;
    },
  };
}

/**
 * A2A client with a per-URL cache. `send` streams a message to an agent and
 * reports progress; it resolves with the final text and task state.
 */
export function createA2AClient({ headers = {} } = {}) {
  const factory = new ClientFactory();
  const clients = new Map();

  async function clientFor(url) {
    const key = url.endsWith("/") ? url : `${url}/`;
    if (!clients.has(key)) clients.set(key, factory.createFromUrl(key).catch((err) => { clients.delete(key); throw err; }));
    return clients.get(key);
  }

  return {
    forget: (url) => clients.delete(url.endsWith("/") ? url : `${url}/`),
    async fetchCard(url) {
      const res = await fetch(new URL(AGENT_CARD_PATH, url.endsWith("/") ? url : `${url}/`), { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Agent card HTTP ${res.status}`);
      return res.json();
    },
    /**
     * @returns {Promise<{ text: string, state: number, taskId: string, contextId: string }>}
     */
    async send(url, { text, contextId = "", metadata = {}, onStatus, signal }) {
      const client = await clientFor(url);
      const request = { message: userMessage({ text, contextId, metadata }), configuration: undefined, metadata: {}, tenant: "" };
      const options = { signal, serviceParameters: headers };
      let task = null;
      let direct = null;
      const artifacts = new Map();
      let lastStatusText = "";

      for await (const event of client.sendMessageStream(request, options)) {
        const payload = event?.payload ?? event;
        const kind = payload?.$case;
        const value = payload?.value;
        if (kind === "task") task = value;
        else if (kind === "message") direct = value;
        else if (kind === "statusUpdate") {
          task = task ? { ...task, status: value.status } : { id: value.taskId, contextId: value.contextId, status: value.status, artifacts: [] };
          const statusText = partsToText(value.status?.message?.parts);
          if (statusText) {
            lastStatusText = statusText;
            onStatus?.(value.status.state, statusText);
          }
        } else if (kind === "artifactUpdate") {
          const prev = artifacts.get(value.artifact.artifactId);
          artifacts.set(value.artifact.artifactId, value.append && prev ? { ...prev, parts: [...prev.parts, ...value.artifact.parts] } : value.artifact);
        }
      }

      if (direct) return { text: partsToText(direct.parts), state: TaskState.TASK_STATE_COMPLETED, taskId: "", contextId: direct.contextId || contextId };
      const artifactText = [...artifacts.values()].map((a) => partsToText(a.parts)).filter(Boolean).join("\n\n")
        || (task?.artifacts || []).map((a) => partsToText(a.parts)).filter(Boolean).join("\n\n");
      return {
        text: artifactText || partsToText(task?.status?.message?.parts) || lastStatusText,
        state: task?.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED,
        taskId: task?.id || "",
        contextId: task?.contextId || contextId,
      };
    },
  };
}
