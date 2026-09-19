// Office orchestration: routes user messages to agents and runs agent→agent
// delegation, always over A2A (local agents through their own endpoint on the
// loopback URL, remote agents through their published URL).
import { Cron } from "croner";
import { TaskState } from "./a2a.js";
import { agentBaseUrl } from "./a2a.js";
import { config } from "./config.js";

const STATE_LABEL = {
  [TaskState.TASK_STATE_COMPLETED]: "completed",
  [TaskState.TASK_STATE_FAILED]: "failed",
  [TaskState.TASK_STATE_CANCELED]: "canceled",
  [TaskState.TASK_STATE_REJECTED]: "rejected",
  [TaskState.TASK_STATE_INPUT_REQUIRED]: "input-required",
  [TaskState.TASK_STATE_AUTH_REQUIRED]: "auth-required",
};

/** Resolve @Name mentions (case-insensitive, longest name first) to agents. */
export function parseMentions(content, agents) {
  const found = [];
  const lower = String(content).toLowerCase();
  const byLength = [...agents].sort((a, b) => b.name.length - a.name.length);
  for (const agent of byLength) {
    const needle = `@${agent.name.toLowerCase()}`;
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      const after = lower[idx + needle.length];
      if (!after || !/[\p{L}\p{N}_-]/u.test(after)) {
        if (!found.includes(agent)) found.push(agent);
        break;
      }
      idx = lower.indexOf(needle, idx + 1);
    }
  }
  return found;
}

/** The office lead: first agent without a manager (or the first agent). */
export function officeLead(agents) {
  return agents.find((a) => !a.managerId && a.kind === "local") || agents.find((a) => a.kind === "local") || agents[0] || null;
}

export function createOffice({ db, hub, a2a, selfUrl = config.selfUrl, headers = {} }) {
  const urlFor = (agent) => (agent.kind === "remote" ? agent.remoteUrl : agentBaseUrl(agent.id, selfUrl));

  async function runOnAgent(agent, { text, contextId, metadata, onStatus, signal }) {
    return a2a.send(urlFor(agent), { text, contextId, metadata, onStatus, signal });
  }

  /** delegate_task implementation (called from the tool runner). */
  async function delegate({ fromAgent, targetName, task, depth = 0, signal }) {
    const team = db.listAgents(fromAgent.officeId);
    const needle = targetName.trim().replace(/^@/, "").toLowerCase();
    const target = team.find((a) => a.name.toLowerCase() === needle) || team.find((a) => a.name.toLowerCase().startsWith(needle));
    if (!target) return `Error: no agent named "${targetName}". Available: ${team.filter((a) => a.id !== fromAgent.id).map((a) => a.name).join(", ") || "none"}`;
    if (target.id === fromAgent.id) return "Error: you cannot delegate to yourself";
    if (depth + 1 > config.agent.maxDelegationDepth) return `Error: delegation depth limit (${config.agent.maxDelegationDepth}) reached; do the task yourself`;

    const officeId = fromAgent.officeId;
    hub.post({ officeId, kind: "delegation", agentId: fromAgent.id, fromAgentId: fromAgent.id, toAgentId: target.id, content: task });
    hub.activity(officeId, target.id, "working", `task from ${fromAgent.name}`);
    try {
      const result = await runOnAgent(target, {
        text: task,
        // A fresh context per delegation: the target sees only the handed-over task.
        contextId: "",
        metadata: { office: { officeId, fromAgentId: fromAgent.id, depth: depth + 1 } },
        signal,
      });
      const state = STATE_LABEL[result.state] || "completed";
      hub.post({ officeId, kind: "agent", agentId: target.id, toAgentId: fromAgent.id, taskId: result.taskId, contextId: result.contextId, content: result.text || "(no output)", meta: { state, delegatedBy: fromAgent.id } });
      return state === "completed" ? result.text || "(no output)" : `[${target.name} task ${state}] ${result.text || ""}`.trim();
    } catch (err) {
      hub.post({ officeId, kind: "error", agentId: target.id, content: `Delegation from ${fromAgent.name} failed: ${err.message}` });
      return `Error: delegation to ${target.name} failed: ${err.message}`;
    } finally {
      if (target.kind === "remote") hub.activity(officeId, target.id, "idle", "");
    }
  }

  const inflight = new Map(); // agentId → AbortController for user-initiated runs

  /**
   * Send a user message into the office. Targets: explicit agentId, else
   * @mentions, else the office lead. Runs in the background; progress and
   * replies arrive on the office event stream.
   */
  function sendUserMessage(officeId, { content, agentId, source = "user" }) {
    const office = db.getOffice(officeId);
    if (!office) throw Object.assign(new Error("Office not found"), { status: 404 });
    const agents = db.listAgents(officeId);
    if (!agents.length) throw Object.assign(new Error("This office has no agents yet"), { status: 400 });

    let targets = agentId ? agents.filter((a) => a.id === agentId) : parseMentions(content, agents);
    if (!targets.length) targets = [officeLead(agents)].filter(Boolean);
    if (!targets.length) throw Object.assign(new Error("No agent to receive the message"), { status: 400 });

    const entry = hub.post({ officeId, kind: "user", content, meta: { source, to: targets.map((t) => t.id) } });

    for (const target of targets) {
      const abort = new AbortController();
      inflight.get(target.id)?.abort();
      inflight.set(target.id, abort);
      // One stable A2A context per (office, agent, conversation epoch) keeps chat memory.
      const contextId = `office-${officeId}-${target.id}-${office.chatEpoch || 0}`;
      hub.activity(officeId, target.id, "working", source === "schedule" ? "scheduled task" : "message");
      runOnAgent(target, {
        text: content,
        contextId,
        metadata: { office: { officeId, depth: 0, source } },
        signal: abort.signal,
        onStatus: target.kind === "remote" ? (_state, text) => hub.activity(officeId, target.id, "working", text.slice(0, 120)) : undefined,
      })
        .then((result) => {
          const state = STATE_LABEL[result.state] || "completed";
          hub.post({ officeId, kind: state === "completed" ? "agent" : "error", agentId: target.id, taskId: result.taskId, contextId: result.contextId, content: result.text || `(task ${state})`, meta: { state, replyTo: entry.id } });
        })
        .catch((err) => {
          if (abort.signal.aborted) return;
          hub.post({ officeId, kind: "error", agentId: target.id, content: `Request failed: ${err.message}`, meta: { replyTo: entry.id } });
        })
        .finally(() => {
          if (inflight.get(target.id) === abort) inflight.delete(target.id);
          if (target.kind === "remote") hub.activity(officeId, target.id, "idle", "");
        });
    }
    return { entry, targets: targets.map((t) => t.id) };
  }

  function stopAgent(agentId) {
    const abort = inflight.get(agentId);
    if (!abort) return false;
    abort.abort();
    inflight.delete(agentId);
    return true;
  }

  // ── scheduler ─────────────────────────────────────────────
  const jobs = new Map();
  function schedule(row) {
    jobs.get(row.id)?.stop();
    if (!row.enabled) return jobs.delete(row.id);
    try {
      jobs.set(row.id, new Cron(row.cron, { protect: true }, () => {
        const current = db.getSchedule(row.id);
        if (!current?.enabled) return;
        db.markScheduleRun(row.id);
        try {
          sendUserMessage(row.officeId, { content: row.prompt, agentId: row.agentId, source: "schedule" });
        } catch (err) {
          hub.post({ officeId: row.officeId, kind: "error", agentId: row.agentId, content: `Scheduled task failed: ${err.message}` });
        }
      }));
    } catch (err) {
      hub.post({ officeId: row.officeId, kind: "error", agentId: row.agentId, content: `Invalid schedule "${row.cron}": ${err.message}` });
    }
  }
  function unschedule(id) {
    jobs.get(id)?.stop();
    jobs.delete(id);
  }
  function nextRun(id) {
    return jobs.get(id)?.nextRun()?.toISOString() || null;
  }
  function startScheduler() {
    for (const row of db.listAllSchedules()) schedule(row);
  }
  function stopAll() {
    for (const job of jobs.values()) job.stop();
    jobs.clear();
    for (const abort of inflight.values()) abort.abort();
  }

  return { delegate, sendUserMessage, stopAgent, schedule, unschedule, nextRun, startScheduler, stopAll, urlFor };
}
