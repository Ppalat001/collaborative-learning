import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/auth/routeAuth";
import { conditionManager } from "@/lib/intervention/ResearchConditionManager";
import { getParticipantInSession, getSessionByCode } from "@/lib/services/sessions";
import { markParticipantDroppedOut } from "@/lib/services/studyV2";
import { isAdminRequest } from "@/lib/utils/admin";

/**
 * Records that a member left a started V2 group for good, so the remaining members
 * can still finish ("I am good" no longer waits for them). Nothing is deleted.
 * Body: { session: CODE, participantId, note? }
 */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const code = typeof body.session === "string" ? body.session.trim().toUpperCase() : "";
    const session = code ? await getSessionByCode(code) : null;
    if (!session) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    if (!(await conditionManager.getAssignment(session.id))) {
      return NextResponse.json({ error: "Drop-outs are only recorded for V2 groups" }, { status: 400 });
    }
    const participant = await getParticipantInSession(session.id, body.participantId);
    if (!participant) return NextResponse.json({ error: "Member not found in this group" }, { status: 404 });
    const consent = await markParticipantDroppedOut(session.id, participant.id, body.note);
    return NextResponse.json({ droppedOutAt: consent.droppedOutAt });
  } catch (error) {
    return errorResponse(error, "Failed to record the drop-out");
  }
}
