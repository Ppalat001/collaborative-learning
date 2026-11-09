import { NextResponse } from "next/server";
import { authorizeParticipant, errorResponse } from "@/lib/auth/routeAuth";
import { getGroupTimeline } from "@/lib/services/groupTimeline";

/**
 * The Step 1 group chat as one ordered list (human messages, group AI replies and
 * offers, shared excerpts). Same access rule as the chat: the caller's device
 * token, active consent and the frozen roster. Never contains private items.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const url = new URL(request.url);
    const scenarioOrder = Number(url.searchParams.get("scenarioOrder"));
    if (!Number.isInteger(scenarioOrder) || scenarioOrder < 1) {
      return NextResponse.json({ error: "Invalid scenario order" }, { status: 400 });
    }
    const auth = await authorizeParticipant(request, code, url.searchParams.get("participantId"), {
      requireScenarioAccess: true,
    });
    if (!auth.ok) return auth.response;
    if (!auth.assignment) return NextResponse.json({ error: "Not available for this group" }, { status: 404 });
    const events = await getGroupTimeline({
      session: auth.session,
      assignment: auth.assignment,
      scenarioOrder,
      viewerId: auth.participant.id,
    });
    return NextResponse.json({ scenarioOrder, events });
  } catch (error) {
    return errorResponse(error, "Failed to load the group chat");
  }
}
