import { NextResponse } from "next/server";
import { authorizeParticipant, loadSessionContext } from "@/lib/auth/routeAuth";
import {
  getParticipantAssessment,
  saveAssessment,
} from "@/lib/services/sessions";
import {
  getAssessment,
  parseOpenAnswers,
  scoreAssessment,
} from "@/lib/utils/assessment";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const { searchParams } = new URL(request.url);
    const participantId = searchParams.get("participantId");
    const assessmentType = searchParams.get("type") === "post" ? "post" : "pre";

    const loaded = await loadSessionContext(code);
    if (!loaded.ok) return loaded.response;
    const { session, assignment } = loaded.ctx;

    if (!participantId) {
      return NextResponse.json({ completed: false });
    }
    if (assignment) {
      const auth = await authorizeParticipant(request, code, participantId);
      if (!auth.ok) return auth.response;
    }

    const assessment = await getParticipantAssessment(
      session.id,
      participantId,
      assessmentType
    );

    return NextResponse.json({
      completed: !!assessment,
      score: assessment?.score ?? null,
      maxScore: assessment?.maxScore ?? null,
    });
  } catch (error) {
    console.error("Assessment fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch assessment" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const assessmentType = body.assessmentType === "post" ? "post" : "pre";
    const answers = body.answers as Record<string, number>;
    let participantId = body.participantId ? String(body.participantId) : undefined;

    const loaded = await loadSessionContext(code);
    if (!loaded.ok) return loaded.response;
    const { session, assignment } = loaded.ctx;

    if (assignment) {
      // V2: only the consenting member themself; the post-test only after the group started.
      const auth = await authorizeParticipant(request, code, participantId, {
        requireConsent: assessmentType === "pre",
        requireScenarioAccess: assessmentType === "post",
      });
      if (!auth.ok) return auth.response;
      participantId = auth.participant.id;
      if (assessmentType === "pre" && assignment.rosterFrozenAt) {
        const existing = await getParticipantAssessment(session.id, participantId, "pre");
        if (!existing) {
          return NextResponse.json(
            { error: "The pre-test closes when the group starts the scenarios" },
            { status: 409 }
          );
        }
      }
    }

    const openAnswers = parseOpenAnswers(assessmentType, body.openAnswers);
    const missing = getAssessment(assessmentType).openQuestions.find(
      (question) => !openAnswers[question.id]
    );
    if (missing) {
      return NextResponse.json(
        { error: "Please answer the written questions too" },
        { status: 400 }
      );
    }

    const { score, maxScore } = scoreAssessment(assessmentType, answers);
    const assessment = await saveAssessment(
      session.id,
      assessmentType,
      answers,
      openAnswers,
      score,
      maxScore,
      participantId
    );

    return NextResponse.json({
      assessmentType,
      score,
      maxScore,
      completedAt: assessment.completedAt,
    });
  } catch (error) {
    console.error("Assessment error:", error);
    return NextResponse.json({ error: "Failed to save assessment" }, { status: 500 });
  }
}
