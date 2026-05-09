import { NextResponse } from "next/server";
import { getMemoryEntries, createMemoryEntry } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get("officeId");
    const agentId = searchParams.get("agentId");
    if (!officeId) return NextResponse.json({ error: "officeId required" }, { status: 400 });
    const entries = await getMemoryEntries({ officeId, agentId: agentId || undefined });
    return NextResponse.json({ entries });
  } catch (error) {
    console.log("Error fetching memory:", error);
    return NextResponse.json({ error: "Failed to fetch memory" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { officeId, agentId, type, content } = body;
    if (!officeId || !content) return NextResponse.json({ error: "officeId and content required" }, { status: 400 });
    const entry = await createMemoryEntry({ officeId, agentId, type, content });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.log("Error creating memory:", error);
    return NextResponse.json({ error: "Failed to create memory" }, { status: 500 });
  }
}
