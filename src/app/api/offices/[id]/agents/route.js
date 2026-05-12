import { NextResponse } from "next/server";
import { getAgentsByOffice, createAgent } from "@/lib/db";

// GET /api/offices/[id]/agents - List agents for an office
export async function GET(request, { params }) {
  try {
    const { id: officeId } = await params;
    const agents = await getAgentsByOffice(officeId);
    return NextResponse.json({ agents });
  } catch (error) {
    console.log("Error fetching agents:", error);
    return NextResponse.json({ error: "Failed to fetch agents" }, { status: 500 });
  }
}

// POST /api/offices/[id]/agents - Create an agent
export async function POST(request, { params }) {
  try {
    const { id: officeId } = await params;
    const body = await request.json();
    const { name, role, comboId, modelId, systemPrompt, characterSprite } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const agent = await createAgent({ officeId, name, role, comboId, modelId, systemPrompt, characterSprite });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    console.log("Error creating agent:", error);
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
}
