import { NextResponse } from "next/server";
import { conditionManager } from "@/lib/intervention/ResearchConditionManager";
import { getSessionByCode } from "@/lib/services/sessions";
import { isAdminRequest } from "@/lib/utils/admin";
import { buildGroupExport, isExportType, toCsv } from "@/lib/utils/export";
import { buildV2Export, isV2ExportType, listV2SessionIds } from "@/lib/utils/exportV2";
import { buildV23Export, isV23ExportType } from "@/lib/utils/exportV23";

function csvResponse(csv: string, filename: string) {
  // BOM so Excel opens names and answers with accents correctly.
  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * Original exports: `?type=<legacy type>&session=CODE` (unchanged).
 * V2 and V2.3 exports: `?type=v2_*|v2_3_*&session=CODE` for one V2 group, or
 * `&scope=all` for every V2 group in one file (legacy groups are never included).
 */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "scenarios";

  if (isV2ExportType(type) || isV23ExportType(type)) {
    const build = (sessionIds: string[]) =>
      isV23ExportType(type) ? buildV23Export(type, sessionIds) : buildV2Export(type, sessionIds);
    try {
      if (searchParams.get("scope") === "all") {
        const { columns, rows } = build(listV2SessionIds());
        return csvResponse(toCsv(columns, rows), `all-v2-groups-${type}.csv`);
      }
      const code = searchParams.get("session")?.trim().toUpperCase();
      if (!code) {
        return NextResponse.json({ error: "Choose a group, or all V2 groups, to export" }, { status: 400 });
      }
      const session = await getSessionByCode(code);
      if (!session) {
        return NextResponse.json({ error: `Group ${code} not found` }, { status: 404 });
      }
      if (!(await conditionManager.getAssignment(session.id))) {
        return NextResponse.json(
          { error: `Group ${code} is a legacy group and has no Adaptive Scaffolding V2 data` },
          { status: 400 }
        );
      }
      const { columns, rows } = build([session.id]);
      return csvResponse(toCsv(columns, rows), `${session.code}-${type}.csv`);
    } catch (error) {
      console.error("V2 export error:", error);
      return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
    }
  }

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
    return csvResponse(toCsv(columns, rows), `${session.code}-${type}.csv`);
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}
