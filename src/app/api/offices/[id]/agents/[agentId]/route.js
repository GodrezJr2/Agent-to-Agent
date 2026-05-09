import { NextResponse } from "next/server";
import { getAgentById, updateAgent, deleteAgent } from "@/lib/db";

// GET /api/offices/[id]/agents/[agentId] - Get single agent
export async function GET(request, { params }) {
  try {
    const { agentId } = await params;
    const agent = await getAgentById(agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({ agent });
  } catch (error) {
    console.log("Error fetching agent:", error);
    return NextResponse.json({ error: "Failed to fetch agent" }, { status: 500 });
  }
}

// PUT /api/offices/[id]/agents/[agentId] - Update an agent
export async function PUT(request, { params }) {
  try {
    const { agentId } = await params;
    const body = await request.json();
    const updated = await updateAgent(agentId, body);
    if (!updated) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({ agent: updated });
  } catch (error) {
    console.log("Error updating agent:", error);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}

// DELETE /api/offices/[id]/agents/[agentId] - Delete an agent
export async function DELETE(request, { params }) {
  try {
    const { agentId } = await params;
    await deleteAgent(agentId);
    return NextResponse.json({ message: "Agent deleted" });
  } catch (error) {
    console.log("Error deleting agent:", error);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
