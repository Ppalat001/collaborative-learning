import { NextResponse } from "next/server";
import { authorizeParticipant, errorResponse } from "@/lib/auth/routeAuth";
import { getOrchestrator } from "@/lib/intervention/InterventionOrchestrator";

/**
 * Client-observed exposure of an offer (policy-v2-3+): socket_delivered |
 * client_displayed_in_viewport | user_opened | indicator_dismissed. Once per
 * member, offer and kind; the client clock is only kept when plausible.
 */
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
    const result = getOrchestrator().recordClientExposure({
      session: auth.session,
      assignment: auth.assignment,
      participant: auth.participant,
      interventionId: id,
      kind: body.kind,
      clientAt: body.clientAt,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "Failed to record that the suggestion was seen");
  }
}
