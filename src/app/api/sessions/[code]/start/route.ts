import { NextResponse } from "next/server";
import { authorizeParticipant, errorResponse } from "@/lib/auth/routeAuth";
import { eligibilityGuard } from "@/lib/intervention/ResearchEligibilityGuard";
import { logResearchEvent } from "@/lib/utils/export";

/**
 * V2 start gate: every member consented and finished the pre-test, group size
 * within the protocol's bounds; then the roster is frozen. Idempotent.
 * Legacy groups have no server-side gate (original behavior).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json().catch(() => ({}));
    const auth = await authorizeParticipant(request, code, body.participantId, {
      requireConsent: true,
    });
    if (!auth.ok) return auth.response;
    if (!auth.assignment) return NextResponse.json({ legacy: true, started: true });

    const result = eligibilityGuard.freezeMembership(auth.session.id, auth.participant.id);
    if (!result.alreadyStarted) {
      await logResearchEvent(
        auth.session.id,
        "v2_scenarios_started",
        { roster: result.roster, rosterSize: result.roster.length },
        auth.participant.id
      );
    }
    return NextResponse.json({ started: true, startedAt: result.startedAt, rosterSize: result.roster.length });
  } catch (error) {
    return errorResponse(error, "Failed to start the scenarios");
  }
}
