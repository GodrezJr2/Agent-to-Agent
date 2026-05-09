import { NextResponse } from "next/server";
import { getOffices, createOffice } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/offices - List offices
export async function GET() {
  try {
    const offices = await getOffices();
    return NextResponse.json({ offices });
  } catch (error) {
    console.log("Error fetching offices:", error);
    return NextResponse.json({ error: "Failed to fetch offices" }, { status: 500 });
  }
}

// POST /api/offices - Create office
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const office = await createOffice({ name, description });
    return NextResponse.json({ office }, { status: 201 });
  } catch (error) {
    console.log("Error creating office:", error);
    return NextResponse.json({ error: "Failed to create office" }, { status: 500 });
  }
}
