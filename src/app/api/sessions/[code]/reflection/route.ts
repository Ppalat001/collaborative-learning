import { NextResponse } from "next/server";
import {
  getFinalReflection,
  getParticipantInSession,
  getSessionByCode,
  saveFinalReflection,
} from "@/lib/services/sessions";
import { FINAL_REFLECTION_QUESTIONS } from "@/lib/instruments";

const MAX_ANSWER_LENGTH = 5000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const participantId = new URL(request.url).searchParams.get("participantId");
    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const participant = await getParticipantInSession(session.id, participantId);
    if (!participant) return NextResponse.json({ completed: false });

    const reflection = await getFinalReflection(session.id, participant.id);
    return NextResponse.json({ completed: !!reflection });
  } catch (error) {
    console.error("Reflection fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch reflection" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const participant = await getParticipantInSession(session.id, body.participantId);
    if (!participant) {
      return NextResponse.json({ error: "Participant not found" }, { status: 400 });
    }

    const answers: Record<string, string> = {};
    for (const question of FINAL_REFLECTION_QUESTIONS) {
      answers[question.id] = String(body.answers?.[question.id] ?? "")
        .trim()
        .slice(0, MAX_ANSWER_LENGTH);
    }

    await saveFinalReflection(session.id, participant.id, answers);
    return NextResponse.json({ completed: true });
  } catch (error) {
    console.error("Reflection error:", error);
    return NextResponse.json({ error: "Failed to save reflection" }, { status: 500 });
  }
}
