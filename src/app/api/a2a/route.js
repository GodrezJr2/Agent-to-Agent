import { NextResponse } from "next/server";
import { getA2aMessages, createA2aMessage } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get("officeId");
    if (!officeId) return NextResponse.json({ error: "officeId required" }, { status: 400 });
    const messages = await getA2aMessages(officeId);
    return NextResponse.json({ messages });
  } catch (error) {
    console.log("Error fetching A2A:", error);
    return NextResponse.json({ error: "Failed to fetch A2A messages" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { fromAgentId, toAgentId, officeId, type, content } = body;
    if (!fromAgentId || !officeId || !content) {
      return NextResponse.json({ error: "fromAgentId, officeId, content required" }, { status: 400 });
    }
    const msg = await createA2aMessage({ fromAgentId, toAgentId, officeId, type, content });
    return NextResponse.json({ message: msg }, { status: 201 });
  } catch (error) {
    console.log("Error creating A2A:", error);
    return NextResponse.json({ error: "Failed to create A2A message" }, { status: 500 });
  }
}
