import { NextResponse } from "next/server";
import { authorizeParticipant } from "@/lib/auth/routeAuth";
import { getOrchestrator } from "@/lib/intervention/InterventionOrchestrator";
import { addDiscussionMessage } from "@/lib/services/sessions";
import { MAX_MESSAGE_LENGTH } from "@/lib/instruments";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const scenarioOrder = Number(body.scenarioOrder);
    const text = String(body.text ?? "").trim();

    if (!Number.isInteger(scenarioOrder) || scenarioOrder < 1) {
      return NextResponse.json({ error: "Invalid scenario order" }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "Message is empty" }, { status: 400 });
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Messages can be at most ${MAX_MESSAGE_LENGTH} characters` },
        { status: 400 }
      );
    }

    const auth = await authorizeParticipant(request, code, body.participantId, {
      missingStatus: 400,
      missingMessage: "Join the session from the home page before sending messages",
      requireScenarioAccess: true,
    });
    if (!auth.ok) return auth.response;
    const { session, participant, assignment } = auth;

    const message = await addDiscussionMessage(
      session.id,
      scenarioOrder,
      participant.id,
      text
    );
    if (!message) {
      return NextResponse.json(
        { error: "This scenario has already been submitted" },
        { status: 409 }
      );
    }

    if (assignment) {
      getOrchestrator().onHumanActivity({
        sessionId: session.id,
        sessionCode: session.code,
        scenarioOrder,
        participantId: participant.id,
        kind: "message",
      });
    }

    return NextResponse.json({ message });
  } catch (error) {
    console.error("Message error:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
