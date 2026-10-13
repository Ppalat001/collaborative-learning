import { NextResponse } from "next/server";
import {
  addDiscussionMessage,
  getParticipantInSession,
  getSessionByCode,
} from "@/lib/services/sessions";
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

    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const participant = await getParticipantInSession(session.id, body.participantId);
    if (!participant) {
      return NextResponse.json(
        { error: "Join the session from the home page before sending messages" },
        { status: 400 }
      );
    }

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

    return NextResponse.json({ message });
  } catch (error) {
    console.error("Message error:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
