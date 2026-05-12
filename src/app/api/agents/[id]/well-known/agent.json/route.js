import { NextResponse } from "next/server";
import { getAgentById } from "@/lib/db";

export const dynamic = "force-dynamic";

const PORT = process.env.PORT || 20128;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${PORT}`;

export async function GET(request, { params }) {
  const { id } = await params;
  const agent = await getAgentById(id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agentCard = {
    name: agent.name,
    description: agent.role || `AI agent: ${agent.name}`,
    url: `${BASE_URL}/api/agents/${id}/a2a`,
    version: "1.0.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    skills: agent.role ? [{ id: "default", name: agent.role, description: agent.systemPrompt || agent.role }] : [],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
  };

  return NextResponse.json(agentCard);
}
