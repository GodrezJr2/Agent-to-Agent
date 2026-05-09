import { NextResponse } from "next/server";
import { getChatMessages } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id: officeId } = await params;
    const { searchParams } = new URL(request.url);
    const before = searchParams.get("before") || undefined;
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const messages = await getChatMessages(officeId, { limit, before });
    return NextResponse.json({ messages });
  } catch (error) {
    console.log("Error fetching chat:", error);
    return NextResponse.json({ error: "Failed to fetch chat" }, { status: 500 });
  }
}
