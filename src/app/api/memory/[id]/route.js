import { NextResponse } from "next/server";
import { deleteMemoryEntry } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteMemoryEntry(id);
    if (!deleted) return NextResponse.json({ error: "Memory entry not found" }, { status: 404 });
    return NextResponse.json({ message: "Memory entry deleted" });
  } catch (error) {
    console.log("Error deleting memory:", error);
    return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 });
  }
}
