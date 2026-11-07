import { NextResponse } from "next/server";
import { authorizeParticipant, loadSessionContext } from "@/lib/auth/routeAuth";
import { getOrchestrator } from "@/lib/intervention/InterventionOrchestrator";
import { eligibilityGuard } from "@/lib/intervention/ResearchEligibilityGuard";
import {
  getDiscussionMessages,
  getIndividualScaffolds,
  getOrCreateAttempt,
  getParticipantInSession,
  getParticipantSurvey,
  getSessionMembers,
  setParticipantReady,
  toGroupMembers,
  toIndividualScaffold,
} from "@/lib/services/sessions";
import { getScenarioV2State } from "@/lib/services/interventions";
import { publicStudyInfo } from "@/lib/services/studyV2";
import { normalizeRuns } from "@/lib/authorship";
import { toIsoString } from "@/lib/utils/dates";
import { getScenarioByOrder } from "@/lib/utils/scenarios";

const AGREEMENT_REASON_MAX_LENGTH = 500;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; index: string }> }
) {
  try {
    const { code, index } = await params;
    const scenarioOrder = Number(index);
    const participantId = new URL(request.url).searchParams.get("participantId");
    const loaded = await loadSessionContext(code);
    if (!loaded.ok) return loaded.response;
    const { session, assignment } = loaded.ctx;

    const scenario = getScenarioByOrder(scenarioOrder);
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    let participant = await getParticipantInSession(session.id, participantId);
    if (assignment) {
      // V2: scenario content and private support only for authenticated roster members.
      const auth = await authorizeParticipant(request, code, participantId, {
        requireScenarioAccess: true,
      });
      if (!auth.ok) return auth.response;
      participant = auth.participant;
    }

    const attempt = await getOrCreateAttempt(session.id, scenarioOrder);
    const [survey, messages, members, scaffolds] = await Promise.all([
      participant
        ? getParticipantSurvey(session.id, scenario.id, participant.id)
        : null,
      getDiscussionMessages(session.id, scenarioOrder),
      getSessionMembers(session.id),
      participant ? getIndividualScaffolds(participant.id, scenarioOrder) : [],
    ]);

    let groupMembers = toGroupMembers(members);
    if (assignment) {
      const required = new Set(
        await eligibilityGuard.getRequiredReadyIds(session.id, assignment, members.map((m) => m.id))
      );
      groupMembers = groupMembers.filter((m) => required.has(m.id));
    }

    return NextResponse.json({
      scenario,
      messages,
      members: groupMembers,
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
      v2:
        assignment && participant
          ? {
              ...publicStudyInfo(assignment),
              ...(await getScenarioV2State({
                session,
                assignment,
                attempt,
                scenario,
                participantId: participant.id,
                members: groupMembers,
              })),
            }
          : null,
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

    if (!getScenarioByOrder(scenarioOrder)) {
      const loaded = await loadSessionContext(code);
      if (!loaded.ok) return loaded.response;
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const auth = await authorizeParticipant(request, code, body.participantId, {
      requireScenarioAccess: true,
    });
    if (!auth.ok) return auth.response;
    const { session, participant, assignment } = auth;

    if (body.action === "ready") {
      let agreementReason: string | null = null;
      const mode = assignment?.features.agreementReason ?? "off";
      if (body.ready === true && mode !== "off") {
        agreementReason = String(body.agreementReason ?? "").trim().slice(0, AGREEMENT_REASON_MAX_LENGTH);
        if (mode === "required" && !agreementReason) {
          return NextResponse.json(
            { error: "Write one sentence on why you agree with the answer", code: "reason_required" },
            { status: 400 }
          );
        }
      }
      const result = await setParticipantReady(
        session.id,
        scenarioOrder,
        participant.id,
        body.ready === true,
        { agreementReason }
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      if (assignment && result.value.submitted) {
        await getOrchestrator().onScenarioSubmitted({
          sessionId: session.id,
          sessionCode: session.code,
          scenarioOrder,
        });
      }
      return NextResponse.json(result.value);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Failed to update scenario:", error);
    return NextResponse.json({ error: "Failed to update scenario" }, { status: 500 });
  }
}
