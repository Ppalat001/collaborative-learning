import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/auth/routeAuth";
import { reviewAgreement, sampleReviewWindows, saveReviewLabel } from "@/lib/intervention/learning/HumanReview";
import { conditionManager } from "@/lib/intervention/ResearchConditionManager";
import { getSessionByCode } from "@/lib/services/sessions";
import { isAdminRequest } from "@/lib/utils/admin";
import { listV2SessionIds } from "@/lib/utils/exportV2";

async function v2Session(code: string | null | undefined) {
  const normalized = code?.trim().toUpperCase();
  if (!normalized) return { error: NextResponse.json({ error: "Choose a group" }, { status: 400 }) };
  const session = await getSessionByCode(normalized);
  if (!session) return { error: NextResponse.json({ error: `Group ${normalized} not found` }, { status: 404 }) };
  if (!(await conditionManager.getAssignment(session.id))) {
    return { error: NextResponse.json({ error: `Group ${normalized} is a legacy group` }, { status: 400 }) };
  }
  return { session };
}

/**
 * Human evaluation (admin only).
 * GET ?session=CODE&mode=sample&blind=true&limit=20: pseudonymized decision windows.
 * GET ?session=CODE&mode=agreement (or ?scope=all&mode=agreement): agreement statistics.
 * POST { session, targetType, targetId, raterId, necessity, ... }: save or update one rater's label.
 */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    const mode = params.get("mode") ?? "sample";
    if (mode === "agreement") {
      if (params.get("scope") === "all") return NextResponse.json(reviewAgreement(listV2SessionIds()));
      const found = await v2Session(params.get("session"));
      if (found.error) return found.error;
      return NextResponse.json(reviewAgreement([found.session.id]));
    }
    if (mode !== "sample") return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
    const found = await v2Session(params.get("session"));
    if (found.error) return found.error;
    const limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 20));
    const windows = sampleReviewWindows({
      sessionId: found.session.id,
      blind: params.get("blind") !== "false",
      limit,
      salt: params.get("salt") ?? undefined,
    });
    return NextResponse.json({ group: found.session.code, windows });
  } catch (error) {
    return errorResponse(error, "Failed to load review data");
  }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const found = await v2Session(body.session);
    if (found.error) return found.error;
    const label = saveReviewLabel({ sessionId: found.session.id, body });
    return NextResponse.json({ label });
  } catch (error) {
    return errorResponse(error, "Failed to save the review label");
  }
}
