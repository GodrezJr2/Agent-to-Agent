import { getActiveAgentsByOffice, createMessage } from "@/lib/db";

export const dynamic = "force-dynamic";

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

        const promises = agents.map(async (agent) => {
          send({ type: "agent_start", agentId: agent.id, agentName: agent.name });
          try {
            // TODO: integrate with 9Router's chatCore.js pipeline in Task 14
            const responseContent = `[${agent.name}] Response placeholder for: "${userContent.slice(0, 80)}..."`;
            await createMessage({ officeId, agentId: agent.id, role: "agent", content: responseContent });
            send({ type: "agent_chunk", agentId: agent.id, delta: responseContent, fullResponse: responseContent });
            send({ type: "agent_done", agentId: agent.id, fullResponse: responseContent });
          } catch (err) {
            send({ type: "agent_error", agentId: agent.id, error: err.message });
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
