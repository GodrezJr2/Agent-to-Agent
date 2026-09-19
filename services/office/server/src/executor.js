// AgentExecutor for local office agents: an LLM tool loop through the 9router
// gateway, reported as A2A task events (task → working… → artifact → completed).
import { AgentEvent } from "@a2a-js/sdk/server";
import { Task } from "@a2a-js/sdk";
import { Role, TaskState, agentMessage, partsToText, textPart } from "./a2a.js";
import { toolsForAgent } from "./tools.js";
import { config } from "./config.js";

const nowIso = () => new Date().toISOString();

/** Delegation depth travels in message metadata so chains cannot recurse forever. */
export function delegationDepth(message) {
  const depth = Number(message?.metadata?.office?.depth);
  return Number.isFinite(depth) && depth > 0 ? depth : 0;
}

export function describeTeam(agent, team) {
  const others = team.filter((a) => a.id !== agent.id);
  const label = (a) => `${a.name}${a.role ? ` (${a.role})` : ""}${a.kind === "remote" ? " [external A2A agent]" : ""}`;
  const manager = others.find((a) => a.id === agent.managerId);
  const reports = others.filter((a) => a.managerId === agent.id);
  const peers = others.filter((a) => a !== manager && !reports.includes(a));
  const lines = [];
  if (manager) lines.push(`You report to ${label(manager)}.`);
  if (reports.length) lines.push(`Your direct reports: ${reports.map(label).join(", ")}.`);
  if (peers.length) lines.push(`Other agents in the office: ${peers.map(label).join(", ")}.`);
  return { lines, manager, reports, peers, others };
}

export function buildSystemPrompt(agent, office, team, { canDelegate }) {
  const { lines, reports } = describeTeam(agent, team);
  const base = agent.systemPrompt?.trim()
    || `You are ${agent.name}${agent.role ? `, the ${agent.role}` : ""} in the "${office?.name || "A2A"}" office.${agent.description ? ` ${agent.description}` : ""}`;
  const parts = [base];
  if (lines.length) parts.push(`## Team\n${lines.join("\n")}`);
  if (canDelegate) {
    parts.push(reports.length
      ? "## Delegation\nYou lead a team. Split work into self-contained tasks and hand each to the right report with delegate_task; it returns their result. Review results (read files they wrote) before your final answer. Do not do your reports' work yourself unless delegation fails."
      : "## Delegation\nUse delegate_task only when another agent is clearly better suited. Include full context: they cannot see your conversation.");
  }
  parts.push("## Working style\nActually do the work with your tools; do not just describe it. The shared workspace is the office folder: files you write there are visible to the whole team. Finish with a concise report of what you did and where the output is.");
  return parts.join("\n\n");
}

/** Prior turns of this A2A context, as chat messages (user text → agent artifact text). */
export function contextHistory(db, agentId, contextId, excludeTaskId) {
  const out = [];
  for (const json of db.listContextTaskJson(agentId, contextId)) {
    const task = Task.fromJSON(JSON.parse(json));
    if (task.id === excludeTaskId) continue;
    const asked = (task.history || []).filter((m) => m.role === Role.ROLE_USER).map((m) => partsToText(m.parts)).filter(Boolean).join("\n");
    const answered = (task.artifacts || []).map((a) => partsToText(a.parts)).filter(Boolean).join("\n") || partsToText(task.status?.message?.parts);
    if (asked) out.push({ role: "user", content: asked });
    if (answered) out.push({ role: "assistant", content: answered });
  }
  return out.slice(-40);
}

function summarizeArgs(name, args) {
  const pick = args?.path || args?.command || args?.url || args?.query || args?.agent || args?.key || "";
  const s = typeof pick === "string" ? pick : JSON.stringify(args || {});
  return `${name}(${s.length > 120 ? `${s.slice(0, 117)}...` : s})`;
}

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return { _raw: raw }; }
}

export class OfficeAgentExecutor {
  /**
   * @param {object} deps
   * @param {string} deps.agentId
   * @param {ReturnType<import("./db.js").openDb>} deps.db
   * @param {ReturnType<import("./gateway.js").createGateway>} deps.gateway
   * @param {ReturnType<import("./tools.js").createToolRunner>} deps.tools
   * @param {ReturnType<import("./events.js").createEventHub>} deps.hub
   */
  constructor({ agentId, db, gateway, tools, hub, maxSteps = config.agent.maxSteps, maxDepth = config.agent.maxDelegationDepth, defaultModel = config.gateway.defaultModel }) {
    Object.assign(this, { agentId, db, gateway, tools, hub, maxSteps, maxDepth, defaultModel });
    this.running = new Map();
  }

  cancelTask = async (taskId) => {
    this.running.get(taskId)?.abort();
  };

  async execute(ctx, bus) {
    const { taskId, contextId, userMessage } = ctx;
    const agent = this.db.getAgent(this.agentId);
    const status = (state, text) => bus.publish(AgentEvent.statusUpdate({
      taskId, contextId, metadata: undefined,
      status: { state, timestamp: nowIso(), message: text ? agentMessage({ text, taskId, contextId }) : undefined },
    }));

    bus.publish(AgentEvent.task(ctx.task ?? {
      id: taskId, contextId, artifacts: [], history: [userMessage], metadata: userMessage.metadata || {},
      status: { state: TaskState.TASK_STATE_SUBMITTED, timestamp: nowIso(), message: undefined },
    }));

    if (!agent) {
      status(TaskState.TASK_STATE_FAILED, "Agent no longer exists");
      return;
    }

    const abort = new AbortController();
    this.running.set(taskId, abort);
    const officeId = agent.officeId;
    const activity = (state, detail) => this.hub.activity(officeId, agent.id, state, detail);

    try {
      const office = this.db.getOffice(officeId);
      const team = this.db.listAgents(officeId);
      const depth = delegationDepth(userMessage);
      const canDelegate = team.some((a) => a.id !== agent.id) && depth < this.maxDepth;
      const toolDefs = toolsForAgent(agent, { canDelegate });
      const model = agent.model || this.defaultModel;

      const messages = [
        { role: "system", content: buildSystemPrompt(agent, office, team, { canDelegate }) },
        ...contextHistory(this.db, agent.id, contextId, taskId),
        { role: "user", content: partsToText(userMessage.parts) || "(empty message)" },
      ];

      status(TaskState.TASK_STATE_WORKING, "Thinking");
      activity("thinking", "");

      let finalText = "";
      for (let step = 0; step < this.maxSteps; step++) {
        if (abort.signal.aborted) break;
        const { message } = await this.gateway.chat({ model, messages, tools: toolDefs, signal: abort.signal });
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.filter((c) => c?.function?.name) : [];

        if (!toolCalls.length) {
          finalText = String(message.content || "").trim();
          break;
        }

        messages.push({ role: "assistant", content: message.content || "", tool_calls: toolCalls });
        if (message.content?.trim()) status(TaskState.TASK_STATE_WORKING, message.content.trim());

        for (const call of toolCalls) {
          if (abort.signal.aborted) break;
          const name = call.function.name;
          const args = parseArgs(call.function.arguments);
          const label = summarizeArgs(name, args);
          activity(name === "delegate_task" ? "delegating" : "tool", label);
          status(TaskState.TASK_STATE_WORKING, `Using ${label}`);
          if (name !== "delegate_task") this.hub.post({ officeId, kind: "tool", agentId: agent.id, taskId, contextId, content: label, meta: { tool: name } });

          const result = await this.tools.run(name, args, { agent, depth, signal: abort.signal });
          messages.push({ role: "tool", tool_call_id: call.id || `${name}-${step}`, content: result });
          activity("thinking", "");
        }

        if (step === this.maxSteps - 1) {
          messages.push({ role: "user", content: "Step limit reached. Stop using tools and give your final report now." });
          const { message: last } = await this.gateway.chat({ model, messages, signal: abort.signal });
          finalText = String(last.content || "").trim();
        }
      }

      if (abort.signal.aborted) {
        status(TaskState.TASK_STATE_CANCELED, "Canceled");
        return;
      }

      finalText ||= "(no response)";
      bus.publish(AgentEvent.artifactUpdate({
        taskId, contextId, append: false, lastChunk: true, metadata: undefined,
        artifact: { artifactId: crypto.randomUUID(), name: "response", description: `${agent.name}'s response`, parts: [textPart(finalText)], metadata: undefined, extensions: [] },
      }));
      status(TaskState.TASK_STATE_COMPLETED, undefined);
    } catch (err) {
      const msg = abort.signal.aborted ? "Canceled" : `Error: ${err?.message || String(err)}`;
      status(abort.signal.aborted ? TaskState.TASK_STATE_CANCELED : TaskState.TASK_STATE_FAILED, msg);
    } finally {
      this.running.delete(taskId);
      activity("idle", "");
    }
  }
}
