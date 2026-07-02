import { NextResponse } from "next/server";
import {
  assessmentRowsToCsv,
  buildAssessmentExportRows,
  buildExportRows,
  rowsToCsv,
} from "@/lib/utils/export";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get("password");
  const type = searchParams.get("type");
  const adminPassword = process.env.ADMIN_PASSWORD ?? "research-admin";

  if (password !== adminPassword) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (type === "assessments") {
      const rows = await buildAssessmentExportRows();
      const csv = assessmentRowsToCsv(rows);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="assessments-export-${Date.now()}.csv"`,
        },
      });
    }

    const rows = await buildExportRows();
    const csv = rowsToCsv(rows);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="research-export-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}
