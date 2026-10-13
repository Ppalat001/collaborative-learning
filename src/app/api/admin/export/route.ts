import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/utils/admin";
import { EXPORT_BUILDERS, isExportType, toCsv } from "@/lib/utils/export";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const type = new URL(request.url).searchParams.get("type") ?? "scenarios";
  if (!isExportType(type)) {
    return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
  }

  try {
    const { columns, rows } = await EXPORT_BUILDERS[type]();
    return new NextResponse(toCsv(columns, rows), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${type}-export-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}
