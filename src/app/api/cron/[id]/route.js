import { NextResponse } from "next/server";
import { updateCronJob, deleteCronJob } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await updateCronJob(id, body);
    if (!updated) return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
    return NextResponse.json({ job: updated });
  } catch (error) {
    console.log("Error updating cron job:", error);
    return NextResponse.json({ error: "Failed to update cron job" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteCronJob(id);
    if (!deleted) return NextResponse.json({ error: "Cron job not found" }, { status: 404 });
    return NextResponse.json({ message: "Cron job deleted" });
  } catch (error) {
    console.log("Error deleting cron job:", error);
    return NextResponse.json({ error: "Failed to delete cron job" }, { status: 500 });
  }
}
