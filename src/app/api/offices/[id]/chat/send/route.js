import { NextResponse } from "next/server";
import { createMessage, getActiveAgentsByOffice } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const { id: officeId } = await params;
    const body = await request.json();
    const { content } = body;
    if (!content) return NextResponse.json({ error: "Content is required" }, { status: 400 });

    const userMsg = await createMessage({ officeId, agentId: null, role: "user", content });
    const agents = await getActiveAgentsByOffice(officeId);

    return NextResponse.json({
      message: userMsg,
      agentCount: agents.length,
      streamUrl: `/api/offices/${officeId}/chat/stream`,
    }, { status: 201 });
  } catch (error) {
    console.log("Error sending chat:", error);
    return NextResponse.json({ error: "Failed to send chat" }, { status: 500 });
  }
}
