import { NextResponse } from "next/server";
import {
  getDiscussionMessages,
  getIndividualScaffolds,
  getOrCreateAttempt,
  getParticipantInSession,
  getParticipantSurvey,
  getSessionByCode,
  getSessionMembers,
  setParticipantReady,
  toGroupMembers,
  toIndividualScaffold,
} from "@/lib/services/sessions";
import { normalizeRuns } from "@/lib/authorship";
import { toIsoString } from "@/lib/utils/dates";
import { getScenarioByOrder } from "@/lib/utils/scenarios";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; index: string }> }
) {
  try {
    const { code, index } = await params;
    const scenarioOrder = Number(index);
    const participantId = new URL(request.url).searchParams.get("participantId");
    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const scenario = getScenarioByOrder(scenarioOrder);
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const attempt = await getOrCreateAttempt(session.id, scenarioOrder);
    const participant = await getParticipantInSession(session.id, participantId);
    const [survey, messages, members, scaffolds] = await Promise.all([
      participant
        ? getParticipantSurvey(session.id, scenario.id, participant.id)
        : null,
      getDiscussionMessages(session.id, scenarioOrder),
      getSessionMembers(session.id),
      participant ? getIndividualScaffolds(participant.id, scenarioOrder) : [],
    ]);

    return NextResponse.json({
      scenario,
      messages,
      members: toGroupMembers(members),
      myScaffolds: scaffolds.map(toIndividualScaffold),
      attempt: {
        finalAnswer: attempt.finalAnswer,
        finalAnswerAuthorship: normalizeRuns(
          attempt.finalAnswerAuthorship,
          attempt.finalAnswer.length
        ),
        readyIds: attempt.readyParticipantIds ?? [],
        submitted: attempt.submitted,
        finalAnswerAt: toIsoString(attempt.finalAnswerAt),
      },
      surveyCompleted: !!survey,
    });
  } catch (error) {
    console.error("Failed to load scenario:", error);
    return NextResponse.json({ error: "Failed to load scenario" }, { status: 500 });
  }
}

/** action "ready" with ready true/false toggles the member's "I am good". */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ code: string; index: string }> }
) {
  try {
    const { code, index } = await params;
    const scenarioOrder = Number(index);
    const body = await request.json();
    const session = await getSessionByCode(code);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (!getScenarioByOrder(scenarioOrder)) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const participant = await getParticipantInSession(session.id, body.participantId);
    if (!participant) {
      return NextResponse.json(
        { error: "Join the session on this device first" },
        { status: 403 }
      );
    }

    if (body.action === "ready") {
      const result = await setParticipantReady(
        session.id,
        scenarioOrder,
        participant.id,
        body.ready === true
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json(result.value);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Failed to update scenario:", error);
    return NextResponse.json({ error: "Failed to update scenario" }, { status: 500 });
  }
}
