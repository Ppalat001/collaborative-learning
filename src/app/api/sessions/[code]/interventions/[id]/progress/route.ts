import { NextResponse } from "next/server";
import { authorizeParticipant, errorResponse } from "@/lib/auth/routeAuth";
import { getOrchestrator } from "@/lib/intervention/InterventionOrchestrator";

/** Voluntary "Did this help you make progress?" (yes | partly | no | not_needed | skip), once per member. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const body = await request.json();
    const auth = await authorizeParticipant(request, code, body.participantId, {
      requireScenarioAccess: true,
    });
    if (!auth.ok) return auth.response;
    if (!auth.assignment) {
      return NextResponse.json({ error: "Not available for this group" }, { status: 404 });
    }
    const result = await getOrchestrator().handleProgressFeedback({
      session: auth.session,
      assignment: auth.assignment,
      participant: auth.participant,
      interventionId: id,
      response: body.response,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Failed to record your answer");
  }
}
