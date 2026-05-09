import { getActiveAgentsByOffice, createMessage, getComboById, getCombos } from "@/lib/db";

export const dynamic = "force-dynamic";

const PORT = process.env.PORT || 20128;
const BASE_URL = `http://localhost:${PORT}`;

async function callAgentLLM(agent, userContent, officeId) {
  // Resolve model from agent's combo, or fall back to first available combo, or OpenRouter free model
  let model = "openrouter/google/gemini-2.5-flash";

  // Try agent's combo first
  if (agent.comboId) {
    const combo = await getComboById(agent.comboId);
    if (combo?.models) {
      try {
        const models = typeof combo.models === "string" ? JSON.parse(combo.models) : combo.models;
        if (Array.isArray(models) && models.length > 0) {
          const first = models[0];
          model = first.model || first;
        }
      } catch {}
    }
  } else {
    // Fall back to first available combo
    try {
      const combos = await getCombos();
      if (combos?.length > 0 && combos[0].models) {
        const models = typeof combos[0].models === "string" ? JSON.parse(combos[0].models) : combos[0].models;
        if (Array.isArray(models) && models.length > 0) {
          const first = models[0];
          model = first.model || first;
        }
      }
    } catch {}
  }

  // Build messages
  const messages = [];
  if (agent.systemPrompt) {
    messages.push({ role: "system", content: agent.systemPrompt });
  }
  messages.push({ role: "user", content: userContent });

  // Call 9Router's own chat API (uses provider routing, token saving, etc.)
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown error");
    throw new Error(`LLM call failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  // Read SSE stream from 9Router
  let fullContent = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || "";
          if (delta) fullContent += delta;
        } catch {}
      }
    }
  }

  return fullContent;
}

export async function GET(request, { params }) {
  const { id: officeId } = await params;
  const { searchParams } = new URL(request.url);
  const userContent = searchParams.get("content") || "";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const agents = await getActiveAgentsByOffice(officeId);

        if (agents.length === 0 && userContent) {
          send({ type: "all_done", message: "No agents to respond" });
          controller.close();
          return;
        }

        const promises = agents.map(async (agent) => {
          send({ type: "agent_start", agentId: agent.id, agentName: agent.name });
          try {
            const responseContent = await callAgentLLM(agent, userContent, officeId);
            await createMessage({ officeId, agentId: agent.id, role: "agent", content: responseContent });
            send({ type: "agent_chunk", agentId: agent.id, delta: responseContent, fullResponse: responseContent });
            send({ type: "agent_done", agentId: agent.id, fullResponse: responseContent });
          } catch (err) {
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
