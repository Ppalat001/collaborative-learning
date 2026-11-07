import { NextResponse } from "next/server";
import { authorizeParticipant, errorResponse } from "@/lib/auth/routeAuth";
import { getOrchestrator } from "@/lib/intervention/InterventionOrchestrator";

const notV2 = () => NextResponse.json({ error: "Not available for this group" }, { status: 404 });

function parseOrder(value: unknown): number | null {
  const order = Number(value);
  return Number.isInteger(order) && order >= 1 ? order : null;
}

/** Group-visible items plus only the caller's own private offers. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const url = new URL(request.url);
    const scenarioOrder = parseOrder(url.searchParams.get("scenarioOrder"));
    if (!scenarioOrder) return NextResponse.json({ error: "Invalid scenario order" }, { status: 400 });
    const auth = await authorizeParticipant(request, code, url.searchParams.get("participantId"), {
      requireScenarioAccess: true,
    });
    if (!auth.ok) return auth.response;
    if (!auth.assignment) return notV2();
    const state = await getOrchestrator().hydrateInterventionState({
      session: auth.session,
      assignment: auth.assignment,
      scenarioOrder,
      participantId: auth.participant.id,
    });
    return NextResponse.json(state);
  } catch (error) {
    return errorResponse(error, "Failed to load AI facilitator items");
  }
}

/**
 * kind "group_request": ask the shared facilitator (shared_on_demand and up).
 * kind "personal_request": "I'm stuck" private offer (dual_adaptive only).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const scenarioOrder = parseOrder(body.scenarioOrder);
    if (!scenarioOrder) return NextResponse.json({ error: "Invalid scenario order" }, { status: 400 });
    const auth = await authorizeParticipant(request, code, body.participantId, {
      requireScenarioAccess: true,
    });
    if (!auth.ok) return auth.response;
    if (!auth.assignment) return notV2();

    const input = {
      session: auth.session,
      assignment: auth.assignment,
      participant: auth.participant,
      scenarioOrder,
      requestId: body.requestId,
    };
    if (body.kind === "group_request") {
      const result = await getOrchestrator().handleManualGroupRequest({ ...input, supportType: body.supportType });
      return NextResponse.json({ intervention: result.view, duplicate: result.duplicate });
    }
    if (body.kind === "personal_request") {
      const result = await getOrchestrator().handlePersonalRequest(input);
      return NextResponse.json({ intervention: result.view, duplicate: result.duplicate });
    }
    return NextResponse.json({ error: "Unknown request kind" }, { status: 400 });
  } catch (error) {
    return errorResponse(error, "Failed to request AI facilitator help");
  }
}
