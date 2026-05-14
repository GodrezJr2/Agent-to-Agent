import { NextResponse } from "next/server";
import { getAgentById, getComboById, getCombos, createTask, getTask, updateTask, getChatMessages, getActiveAgentsByOffice } from "@/lib/db";
import { AGENT_TOOLS, executeTool } from "@/lib/agentTools";

export const dynamic = "force-dynamic";

const PORT = process.env.PORT || 20128;
const BASE_URL = `http://localhost:${PORT}`;

function jsonRpcError(id, code, message) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function jsonRpcResult(id, result) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

async function resolveModel(agent) {
  if (agent.modelId) {
    return agent.modelId;
  }
  if (agent.comboId) {
    try {
      const combo = await getComboById(agent.comboId);
      if (combo?.models) {
        const models = typeof combo.models === "string" ? JSON.parse(combo.models) : combo.models;
        if (Array.isArray(models) && models.length > 0) return models[0].model || models[0];
      }
    } catch {}
  }
  try {
    const combos = await getCombos();
    if (combos?.length > 0 && combos[0].models) {
      const models = typeof combos[0].models === "string" ? JSON.parse(combos[0].models) : combos[0].models;
      if (Array.isArray(models) && models.length > 0) return models[0].model || models[0];
    }
  } catch {}
  return "openrouter/nvidia/nemotron-3-super-120b-a12b:free";
}

function buildAutoSystemPrompt(agent, allAgents) {
  const name = agent.name;
  const role = agent.role ? ` (${agent.role})` : "";
  const directReports = (allAgents || []).filter((a) => a.managerId === agent.id);
  const manager = agent.managerId ? (allAgents || []).find((a) => a.id === agent.managerId) : null;

  if (directReports.length > 0) {
    const reportNames = directReports.map((r) => `${r.name}${r.role ? ` (${r.role})` : ""}`).join(", ");
    return `You are ${name}${role}. You lead a team and delegate work to your direct reports: ${reportNames}.

When given a task, break it down and assign each part to the right team member using [A2A:Name:task].
After they complete their work, read their output using read_file and write a final summary confirming everything is done.
Never do your team's work yourself — delegate and verify.`;
  }

  const managerLine = manager ? ` You report to ${manager.name}${manager.role ? ` (${manager.role})` : ""}.` : "";
  return `You are ${name}${role}.${managerLine}

When assigned a task, complete it using the tools available (write_file, read_file, bash, web_search, etc.).
Always actually execute the work — don't just describe what you would do.
Report back clearly with what you did and what files or output were created.`;
}

async function callAgentLLM(agent, taskMessage, { fromAgent, officeHistory, allAgents } = {}) {
  const model = await resolveModel(agent);
  const messages = [];

  // System prompt + delegation context
  let systemContent = agent.systemPrompt || buildAutoSystemPrompt(agent, allAgents);
  if (fromAgent) {
    systemContent += `\n\nYou are being called by ${fromAgent.name}${fromAgent.role ? ` (${fromAgent.role})` : ""} to handle a specific task. Respond directly and helpfully with full context.`;
  }
  if (systemContent.trim()) messages.push({ role: "system", content: systemContent });

  // Inject shared office conversation history so agent has context
  if (officeHistory && officeHistory.length > 0) {
    for (const msg of officeHistory) {
      if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content });
      } else if (msg.role === "agent") {
        const cleaned = msg.content.replace(/\*\(asking [^)]+\.\.\.\)\*/g, "").trim();
        if (!cleaned) continue;
        const name = allAgents?.find((a) => a.id === msg.agentId)?.name || "Agent";
        if (msg.agentId === agent.id) {
          messages.push({ role: "assistant", content: cleaned });
        } else {
          messages.push({ role: "user", content: `[${name} said]: ${cleaned}` });
        }
      }
    }
  }

  // The delegated task message
  messages.push({ role: "user", content: taskMessage });

  const officeId = agent.officeId;
  const toolLog = [];
  const MAX_ITERATIONS = 6;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, max_tokens: 2048, tools: AGENT_TOOLS }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      throw new Error(`LLM call failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const msg = choice?.message || {};
    const content = typeof msg.content === "string" ? msg.content : "";
    const toolCalls = msg.tool_calls || [];

    if (!toolCalls.length || choice?.finish_reason === "stop") {
      const summary = toolLog.length > 0
        ? toolLog.map((t) => `> 🔧 **${t.tool}**(${t.args}) → ${t.result.slice(0, 120)}${t.result.length > 120 ? "…" : ""}`).join("\n")
        : "";
      return summary ? `${summary}\n\n${content}` : content;
    }

    messages.push(msg);
    for (const tc of toolCalls) {
      const toolName = tc.function.name;
      let toolArgs = {};
      try { toolArgs = JSON.parse(tc.function.arguments); } catch {}
      const result = await executeTool(toolName, toolArgs, { agentId: agent.id, officeId });
      toolLog.push({ tool: toolName, args: JSON.stringify(toolArgs), result });
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  return messages.findLast((m) => m.role === "assistant")?.content || "(max iterations)";
}

function extractTextFromMessage(message) {
  if (!message) return "";
  if (typeof message === "string") return message;
  const parts = message.parts || message.content || [];
  if (Array.isArray(parts)) {
    return parts.map((p) => (typeof p === "string" ? p : p.text || p.content || "")).join("\n");
  }
  return String(message);
}

export async function POST(request, { params }) {
  const { id: agentId } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const { jsonrpc, method, params: rpcParams, id: rpcId } = body;
  if (jsonrpc !== "2.0") return jsonRpcError(rpcId, -32600, "Invalid Request");
  if (!method) return jsonRpcError(rpcId, -32600, "Method required");

  const agent = await getAgentById(agentId);
  if (!agent) return jsonRpcError(rpcId, -32001, "Agent not found");

  // message/send — creates task, runs LLM, returns completed task
  if (method === "message/send") {
    const message = rpcParams?.message;
    if (!message) return jsonRpcError(rpcId, -32602, "message required");

    const userContent = extractTextFromMessage(message);
    const fromAgentId = rpcParams?.metadata?.fromAgentId || null;
    const officeId = agent.officeId;

    const task = await createTask({ agentId, fromAgentId, officeId, input: { message: userContent } });

    try {
      await updateTask(task.id, { status: "working" });

      // Fetch office history + all agents for context
      const [officeHistory, allAgents, fromAgent] = await Promise.all([
        getChatMessages(officeId, { limit: 20 }),
        getActiveAgentsByOffice(officeId),
        fromAgentId ? getAgentById(fromAgentId) : Promise.resolve(null),
      ]);

      const responseContent = await callAgentLLM(agent, userContent, { fromAgent, officeHistory, allAgents });
      const completed = await updateTask(task.id, {
        status: "completed",
        output: {
          message: {
            role: "agent",
            parts: [{ type: "text", text: responseContent }],
          },
        },
      });

      return jsonRpcResult(rpcId, {
        id: task.id,
        status: { state: "completed" },
        artifacts: [{ parts: [{ type: "text", text: responseContent }] }],
        metadata: completed,
      });
    } catch (err) {
      await updateTask(task.id, { status: "failed", error: err.message });
      return jsonRpcError(rpcId, -32000, err.message);
    }
  }

  // tasks/get — return task by ID
  if (method === "tasks/get") {
    const taskId = rpcParams?.id || rpcParams?.taskId;
    if (!taskId) return jsonRpcError(rpcId, -32602, "task id required");
    const task = await getTask(taskId);
    if (!task) return jsonRpcError(rpcId, -32001, "Task not found");
    return jsonRpcResult(rpcId, { id: task.id, status: { state: task.status }, metadata: task });
  }

  // tasks/cancel — mark task cancelled
  if (method === "tasks/cancel") {
    const taskId = rpcParams?.id || rpcParams?.taskId;
    if (!taskId) return jsonRpcError(rpcId, -32602, "task id required");
    const task = await getTask(taskId);
    if (!task) return jsonRpcError(rpcId, -32001, "Task not found");
    if (task.status === "completed" || task.status === "failed") {
      return jsonRpcError(rpcId, -32002, `Task already ${task.status}`);
    }
    const cancelled = await updateTask(taskId, { status: "cancelled" });
    return jsonRpcResult(rpcId, { id: taskId, status: { state: "cancelled" }, metadata: cancelled });
  }

  return jsonRpcError(rpcId, -32601, `Method not found: ${method}`);
}

// GET returns agent info + recent tasks
export async function GET(request, { params }) {
  const { id } = await params;
  const agent = await getAgentById(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const { getTasksByAgent } = await import("@/lib/db");
  const recentTasks = await getTasksByAgent(id, { limit: 10 });
  return NextResponse.json({ agentId: id, name: agent.name, recentTasks });
}
