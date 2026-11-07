import { NextResponse } from "next/server";
import { authorizeParticipant, loadSessionContext } from "@/lib/auth/routeAuth";
import {
  getFinalReflection,
  getParticipantInSession,
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
    const loaded = await loadSessionContext(code);
    if (!loaded.ok) return loaded.response;
    const { session, assignment } = loaded.ctx;

    const participant = await getParticipantInSession(session.id, participantId);
    if (!participant) return NextResponse.json({ completed: false });
    if (assignment) {
      const auth = await authorizeParticipant(request, code, participantId);
      if (!auth.ok) return auth.response;
    }

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
    const auth = await authorizeParticipant(request, code, body.participantId, {
      missingStatus: 400,
      missingMessage: "Participant not found",
      requireScenarioAccess: true,
    });
    if (!auth.ok) return auth.response;
    const { session, participant } = auth;

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
