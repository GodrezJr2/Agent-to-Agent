import { NextResponse } from "next/server";
import { deleteOffice, getOfficeById, updateOffice } from "@/lib/db";

// GET /api/offices/[id] - Get single office
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const office = await getOfficeById(id);
    if (!office) {
      return NextResponse.json({ error: "Office not found" }, { status: 404 });
    }
    return NextResponse.json({ office });
  } catch (error) {
    console.log("Error fetching office:", error);
    return NextResponse.json({ error: "Failed to fetch office" }, { status: 500 });
  }
}

// PUT /api/offices/[id] - Update office
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description } = body;

    const existing = await getOfficeById(id);
    if (!existing) {
      return NextResponse.json({ error: "Office not found" }, { status: 404 });
    }

    const updated = await updateOffice(id, { name, description });
    return NextResponse.json({ office: updated });
  } catch (error) {
    console.log("Error updating office:", error);
    return NextResponse.json({ error: "Failed to update office" }, { status: 500 });
  }
}

// DELETE /api/offices/[id] - Delete office
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const existing = await getOfficeById(id);
    if (!existing) {
      return NextResponse.json({ error: "Office not found" }, { status: 404 });
    }

    await deleteOffice(id);
    return NextResponse.json({ message: "Office deleted successfully" });
  } catch (error) {
    console.log("Error deleting office:", error);
    return NextResponse.json({ error: "Failed to delete office" }, { status: 500 });
  }
}
