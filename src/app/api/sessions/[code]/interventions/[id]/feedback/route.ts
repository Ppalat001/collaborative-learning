import { NextResponse } from "next/server";
import { authorizeParticipant, errorResponse } from "@/lib/auth/routeAuth";
import { getOrchestrator } from "@/lib/intervention/InterventionOrchestrator";
import { isFeedbackAction } from "@/lib/intervention/types";

/** accepted | dismissed | deferred | viewed | why_viewed. Sharing goes through the share preview. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const body = await request.json();
    if (!isFeedbackAction(body.action)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const auth = await authorizeParticipant(request, code, body.participantId, {
      requireScenarioAccess: true,
    });
    if (!auth.ok) return auth.response;
    if (!auth.assignment) {
      return NextResponse.json({ error: "Not available for this group" }, { status: 404 });
    }
    const view = await getOrchestrator().handlePrivateOfferResponse({
      session: auth.session,
      assignment: auth.assignment,
      participant: auth.participant,
      interventionId: id,
      action: body.action,
      comment: body.comment,
    });
    return NextResponse.json({ intervention: view });
  } catch (error) {
    return errorResponse(error, "Failed to record your response");
  }
}
