import { getActiveAgentsByOffice, createMessage, getComboById, getCombos, getChatMessages } from "@/lib/db";
import { AGENT_TOOLS, executeTool } from "@/lib/agentTools";

export const dynamic = "force-dynamic";

const PORT = process.env.PORT || 20128;
const BASE_URL = `http://localhost:${PORT}`;

async function resolveModel(agent) {
  // Agent has a direct model selected (already in "provider/model" format)
  if (agent.modelId) {
    console.log(`[LLM][${agent.name}] using direct model: ${agent.modelId}`);
    return agent.modelId;
  }
  // Agent uses a combo
  if (agent.comboId) {
    try {
      const combo = await getComboById(agent.comboId);
      if (combo?.models) {
        const models = typeof combo.models === "string" ? JSON.parse(combo.models) : combo.models;
        if (Array.isArray(models) && models.length > 0) {
          const m = models[0].model || models[0];
          console.log(`[LLM][${agent.name}] using combo "${combo.name}": ${m}`);
          return m;
        }
      }
    } catch (e) {
      console.warn(`[LLM][${agent.name}] failed to load combo:`, e.message);
    }
  }
  // Fallback: first available combo
  try {
    const combos = await getCombos();
    if (combos?.length > 0 && combos[0].models) {
      const models = typeof combos[0].models === "string" ? JSON.parse(combos[0].models) : combos[0].models;
      if (Array.isArray(models) && models.length > 0) {
        const m = models[0].model || models[0];
        console.log(`[LLM][${agent.name}] using first combo "${combos[0].name}": ${m}`);
        return m;
      }
    }
  } catch (e) {
    console.warn(`[LLM][${agent.name}] failed to load combos:`, e.message);
  }
  // Last resort
  const fallback = "openrouter/google/gemini-2.5-flash:free";
  console.warn(`[LLM][${agent.name}] no model configured — fallback: ${fallback}`);
  return fallback;
}

// Build hierarchy-aware context injected into every agent's system prompt
function buildAgentContext(currentAgent, allAgents) {
  const others = allAgents.filter((a) => a.id !== currentAgent.id);
  if (others.length === 0) return "";

  // Find who reports to this agent (direct reports)
  const directReports = allAgents.filter((a) => a.managerId === currentAgent.id);
  // Find this agent's manager
  const manager = currentAgent.managerId ? allAgents.find((a) => a.id === currentAgent.managerId) : null;
  // Peers (same manager, not themselves)
  const peers = currentAgent.managerId
    ? others.filter((a) => a.managerId === currentAgent.managerId)
    : others.filter((a) => !a.managerId && directReports.every((r) => r.id !== a.id));

  const lines = [];

  if (manager) {
    lines.push(`Your manager: ${manager.name}${manager.role ? ` (${manager.role})` : ""}`);
  }

  if (directReports.length > 0) {
    lines.push(`\nYour direct reports (you can assign tasks to them):`);
    for (const r of directReports) {
      lines.push(`  - ${r.name}${r.role ? ` (${r.role})` : ""}`);
    }
    lines.push(`\nTo assign a task to a direct report, write [A2A:AgentName:task description] in your reply. The system will call them and inject their response automatically.`);
  } else if (others.length > 0) {
    lines.push(`\nYour colleagues:`);
    for (const a of others) {
      lines.push(`  - ${a.name}${a.role ? ` (${a.role})` : ""}`);
    }
    lines.push(`\nTo delegate to a colleague, write [A2A:AgentName:task] in your reply.`);
  }

  return `\n\n---\n${lines.join("\n")}`;
}

// Parse [A2A:Name:message] tags from response text
function parseDelegations(text) {
  const regex = /\[A2A:([^\]:]+):([^\]]+)\]/g;
  const delegations = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    delegations.push({ raw: match[0], agentName: match[1].trim(), message: match[2].trim() });
  }
  return delegations;
}

// Call another agent via A2A JSON-RPC
async function callAgentA2A(targetAgent, fromAgent, message) {
  const res = await fetch(`${BASE_URL}/api/agents/${targetAgent.id}/a2a`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: {
        message: { role: "user", parts: [{ type: "text", text: message }] },
        metadata: { fromAgentId: fromAgent.id },
      },
    }),
  });
  if (!res.ok) throw new Error(`A2A call failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const artifact = data.result?.artifacts?.[0];
  return artifact?.parts?.map((p) => p.text || "").join("") || "";
}

// Convert DB chat messages to LLM messages array for a specific agent's perspective.
// "user" role messages stay as user, agent messages become assistant (if same agent) or
// a user turn describing what another agent said (so LLM has full context).
function buildHistoryMessages(history, currentAgent, allAgents) {
  const llmMessages = [];
  for (const msg of history) {
    if (msg.role === "user") {
      llmMessages.push({ role: "user", content: msg.content });
    } else if (msg.role === "agent") {
      if (msg.agentId === currentAgent.id) {
        // This agent's own previous reply → assistant turn
        llmMessages.push({ role: "assistant", content: msg.content });
      } else {
        // Another agent's reply → inject as a user turn so LLM sees it
        const otherName = allAgents.find((a) => a.id === msg.agentId)?.name || "Agent";
        llmMessages.push({ role: "user", content: `[${otherName} said]: ${msg.content}` });
      }
    }
    // skip "system" role messages (routing info, errors)
  }
  return llmMessages;
}

// Single non-streaming LLM call — returns { content, toolCalls }
async function llmCall(model, messages, useTools, thinkingBudget = 0) {
  const body = { model, messages, stream: false, max_tokens: 4096 };
  if (useTools) body.tools = AGENT_TOOLS;
  if (thinkingBudget > 0) {
    body.thinking = { type: "enabled", budget_tokens: thinkingBudget };
  }

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`LLM call failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const msg = choice?.message || {};
  const content = choice?.message?.content || "";

  // Extract thinking from various response formats:
  // - msg.reasoning_content (OpenAI std via 9Router translator)
  // - msg.reasoning (DeepSeek R1 via OpenRouter)
  // - msg.content[] with type=thinking (OpenCode/big-pickle)
  let thinking = msg.reasoning_content || msg.reasoning || "";
  if (!thinking && Array.isArray(msg.content)) {
    thinking = msg.content
      .filter((p) => p.type === "thinking")
      .map((p) => p.thinking || "")
      .join("\n");
  }

  return {
    content: typeof content === "string" ? content : (
      Array.isArray(content) ? content.filter(p => p.type === "text").map(p => p.text).join("\n") : String(content)
    ),
    thinking,
    toolCalls: msg.tool_calls || [],
    finishReason: choice?.finish_reason || "stop",
    message: msg,
  };
}

// Agentic tool-use loop:
// 1. Call LLM with tools
// 2. If it calls tools → execute them → feed results back → repeat
// 3. Until finish_reason = "stop" or max iterations hit
async function callAgentLLM(agent, userContent, allAgents, history = [], officeId = "") {
  const model = await resolveModel(agent);
  const agentContext = buildAgentContext(agent, allAgents);
  const systemContent = (agent.systemPrompt || "") + agentContext;

  const messages = [];
  if (systemContent.trim()) messages.push({ role: "system", content: systemContent });
  messages.push(...buildHistoryMessages(history, agent, allAgents));
  messages.push({ role: "user", content: userContent });

  const toolLog = [];
  let allThinking = "";
  const MAX_ITERATIONS = 6;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const { content, thinking, toolCalls, finishReason, message } = await llmCall(model, messages, true, agent.thinkingBudget ?? 0);
    console.log(`[LLM][${agent.name}] iter=${iter} finish=${finishReason} tools=${toolCalls.length} thinking=${thinking.length}c`);

    // Collect thinking across iterations
    if (thinking) allThinking += (allThinking ? "\n---\n" : "") + thinking;

    // No tool calls → done
    if (!toolCalls.length || finishReason === "stop") {
      const finalText = content || "";
      const summary = toolLog.length > 0
        ? toolLog.map((t) => `> 🔧 **${t.tool}**(${t.args}) → ${t.result.slice(0, 120)}${t.result.length > 120 ? "…" : ""}`).join("\n")
        : "";
      return { content: summary ? `${summary}\n\n${finalText}` : finalText, thinking: allThinking };
    }

    messages.push(message);

    for (const tc of toolCalls) {
      const toolName = tc.function.name;
      let toolArgs = {};
      try { toolArgs = JSON.parse(tc.function.arguments); } catch {}
      const result = await executeTool(toolName, toolArgs, { agentId: agent.id, officeId });
      toolLog.push({ tool: toolName, args: JSON.stringify(toolArgs), result });
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  return { content: messages.findLast((m) => m.role === "assistant")?.content || "(max iterations)", thinking: allThinking };
}

// Parse @mentions from user message → returns { mentions: string[], cleanContent: string }
// Supports: @Manager, @"Finance Analyst", @finance_analyst (case-insensitive)
function parseMentions(content) {
  const mentions = [];
  // Match @word, @multi_word, or @"quoted name"
  const regex = /@"([^"]+)"|@([\w\-]+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    mentions.push((match[1] || match[2]).toLowerCase());
  }
  const cleanContent = content.replace(/@"([^"]+)"|@([\w\-]+)/g, "").replace(/\s+/g, " ").trim();
  return { mentions, cleanContent };
}

// Resolve @mention strings to actual agent objects
// Matches against: name (exact), name (contains), role (exact), role (contains)
function resolveTargetAgents(mentions, allAgents) {
  if (mentions.length === 0) return allAgents; // no mentions → broadcast

  const matched = new Set();
  for (const mention of mentions) {
    for (const agent of allAgents) {
      const agentName = agent.name.toLowerCase();
      const agentRole = (agent.role || "").toLowerCase();
      // Exact match first, then contains
      if (agentName === mention || agentRole === mention ||
          agentName.includes(mention) || agentRole.includes(mention)) {
        matched.add(agent);
      }
    }
  }

  if (matched.size === 0) {
    console.warn(`[Mention] No agents matched: ${mentions.join(", ")} — broadcasting to all`);
    return allAgents;
  }

  console.log(`[Mention] Routing to: ${[...matched].map(a => a.name).join(", ")}`);
  return [...matched];
}

export async function GET(request, { params }) {
  const { id: officeId } = await params;
  const { searchParams } = new URL(request.url);
  const rawContent = searchParams.get("content") || "";

  // Parse @mentions and clean content
  const { mentions, cleanContent } = parseMentions(rawContent);
  const userContent = cleanContent || rawContent;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const allAgents = await getActiveAgentsByOffice(officeId);

        if (allAgents.length === 0) {
          send({ type: "all_done", message: "No agents to respond" });
          controller.close();
          return;
        }

        // Save user message exactly once at stream start
        await createMessage({ officeId, agentId: null, role: "user", content: userContent });

        // Fetch last 30 messages as conversation history (now includes current user message)
        const history = await getChatMessages(officeId, { limit: 30 });

        // Route to mentioned agents only, or broadcast if no mentions
        const targetAgents = resolveTargetAgents(mentions, allAgents);

        // Emit routing info so UI can show who is responding
        if (mentions.length > 0) {
          send({
            type: "routing_info",
            mentions,
            targetAgentIds: targetAgents.map(a => a.id),
            targetAgentNames: targetAgents.map(a => a.name),
          });
        }

        const promises = targetAgents.map(async (agent) => {
          send({ type: "agent_start", agentId: agent.id, agentName: agent.name });
          try {
            const result = await callAgentLLM(agent, userContent, allAgents, history, officeId);
            const rawContent = result.content;
            const thinking = result.thinking || "";

            // Detect A2A delegation tags
            const delegations = parseDelegations(rawContent);

            // Clean calling agent's response — replace [A2A:...] tags with a subtle note
            let callerContent = rawContent;
            for (const d of delegations) {
              callerContent = callerContent.replace(d.raw, `*(asking ${d.agentName}...)*`);
            }
            callerContent = callerContent.trim();

            // Send calling agent's bubble with thinking
            if (callerContent) {
              await createMessage({ officeId, agentId: agent.id, role: "agent", content: callerContent });
              send({ type: "agent_chunk", agentId: agent.id, delta: callerContent, fullResponse: callerContent, thinking });
            }
            send({ type: "agent_done", agentId: agent.id, fullResponse: callerContent, thinking });

            // Process each delegation as a SEPARATE bubble for the target agent
            for (const d of delegations) {
              const target = allAgents.find(
                (a) => a.name.toLowerCase() === d.agentName.toLowerCase() && a.id !== agent.id
              );
              if (!target) continue;

              console.log(`[A2A][${agent.name}] → ${target.name}: "${d.message}"`);
              send({ type: "agent_start", agentId: target.id, agentName: target.name });
              try {
                const reply = await callAgentA2A(target, agent, d.message);
                await createMessage({ officeId, agentId: target.id, role: "agent", content: reply });
                send({ type: "agent_chunk", agentId: target.id, delta: reply, fullResponse: reply });
                send({ type: "agent_done", agentId: target.id, fullResponse: reply });
              } catch (err) {
                console.error(`[A2A][${agent.name}→${target.name}] error:`, err.message);
                send({ type: "agent_error", agentId: target.id, error: err.message });
              }
            }
          } catch (err) {
            console.error(`[LLM][${agent.name}] ERROR:`, err.message);
            send({ type: "agent_error", agentId: agent.id, error: err.message });
            await createMessage({ officeId, agentId: agent.id, role: "system", content: `Error: ${err.message}` });
          }
        });

        await Promise.allSettled(promises);
        send({ type: "all_done" });
      } catch (err) {
        send({ type: "error", error: err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
