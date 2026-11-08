import { NextResponse } from "next/server";
import { describeModelConfig } from "@/lib/ai/provider";
import { getPolicy, listPolicyVersions } from "@/lib/intervention/policies";
import {
  ASSIGNABLE_RESEARCH_CONDITIONS,
  readReleaseConfig,
  STUDY_PROTOCOL,
} from "@/lib/intervention/ResearchConditionManager";
import { getSessionByCode } from "@/lib/services/sessions";
import { isAdminRequest } from "@/lib/utils/admin";
import { buildV2Dashboard } from "@/lib/utils/exportV2";

/**
 * Without `session`: the V2 release configuration (no secrets).
 * With `?session=CODE`: decision/intervention summary and warnings for one V2 group.
 */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const code = new URL(request.url).searchParams.get("session")?.trim().toUpperCase();
    if (!code) {
      return NextResponse.json({
        release: readReleaseConfig(),
        aiMode: describeModelConfig().aiMode,
        protocol: {
          version: STUDY_PROTOCOL.protocolVersion,
          status: STUDY_PROTOCOL.status,
          consentVersion: STUDY_PROTOCOL.consent.version,
        },
        conditions: ASSIGNABLE_RESEARCH_CONDITIONS,
        policies: listPolicyVersions().map((version) => ({
          version,
          testOnly: getPolicy(version).testOnly,
          status: getPolicy(version).status,
        })),
      });
    }
    const session = await getSessionByCode(code);
    if (!session) return NextResponse.json({ error: `Group ${code} not found` }, { status: 404 });
    const dashboard = buildV2Dashboard(session.id);
    if (!dashboard) return NextResponse.json({ legacy: true, group: session.code });
    return NextResponse.json(dashboard);
  } catch (error) {
    console.error("Admin interventions error:", error);
    return NextResponse.json({ error: "Failed to load the intervention summary" }, { status: 500 });
  }
}
