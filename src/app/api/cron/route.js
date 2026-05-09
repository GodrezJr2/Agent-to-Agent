import { NextResponse } from "next/server";
import { getCronJobsByOffice, createCronJob } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get("officeId");
    if (!officeId) return NextResponse.json({ error: "officeId required" }, { status: 400 });
    const jobs = await getCronJobsByOffice(officeId);
    return NextResponse.json({ jobs });
  } catch (error) {
    console.log("Error fetching cron jobs:", error);
    return NextResponse.json({ error: "Failed to fetch cron jobs" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { agentId, officeId, schedule, prompt } = body;
    if (!agentId || !officeId || !schedule || !prompt) {
      return NextResponse.json({ error: "agentId, officeId, schedule, and prompt are required" }, { status: 400 });
    }
    const job = await createCronJob({ agentId, officeId, schedule, prompt });
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    console.log("Error creating cron job:", error);
    return NextResponse.json({ error: "Failed to create cron job" }, { status: 500 });
  }
}
