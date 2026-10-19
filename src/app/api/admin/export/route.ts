import { NextResponse } from "next/server";
import { getSessionByCode } from "@/lib/services/sessions";
import { isAdminRequest } from "@/lib/utils/admin";
import { buildGroupExport, isExportType, toCsv } from "@/lib/utils/export";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "scenarios";
  if (!isExportType(type)) {
    return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
  }

  const code = searchParams.get("session")?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json(
      { error: "Choose a group (session code) to export" },
      { status: 400 }
    );
  }

  try {
    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: `Group ${code} not found` }, { status: 404 });
    }
    const { columns, rows } = await buildGroupExport(type, session.id);
    // BOM so Excel opens names and answers with accents correctly.
    return new NextResponse(`\uFEFF${toCsv(columns, rows)}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${session.code}-${type}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}
