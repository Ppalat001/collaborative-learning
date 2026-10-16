import { NextResponse } from "next/server";
import {
  getDiscussionMessages,
  getOrCreateAttempt,
  getParticipantInSession,
  getParticipantSurvey,
  getPendingProposal,
  getSessionByCode,
  getSessionMembers,
  memberName,
  submitFinalAnswer,
} from "@/lib/services/sessions";
import { OWN_WORDS_MIN_WORDS, countWords } from "@/lib/instruments";
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
    const [survey, messages, proposal, members] = await Promise.all([
      participant
        ? getParticipantSurvey(session.id, scenario.id, participant.id)
        : null,
      getDiscussionMessages(session.id, scenarioOrder),
      getPendingProposal(session.id, scenarioOrder),
      getSessionMembers(session.id),
    ]);

    return NextResponse.json({
      scenario,
      messages,
      proposal,
      memberCount: members.length,
      attempt: {
        helpReason: attempt.helpReason,
        scaffoldingType: attempt.scaffoldingType,
        aiResponse: attempt.aiResponse,
        proposedByName: attempt.scaffoldingRequestedBy
          ? memberName(members, attempt.scaffoldingRequestedBy)
          : null,
        agreedByName: attempt.scaffoldingAgreedBy
          ? memberName(members, attempt.scaffoldingAgreedBy)
          : null,
        ownWordsExplanation: attempt.ownWordsExplanation,
        finalAnswer: attempt.finalAnswer,
        submitted: attempt.submitted,
        discussionStartedAt: toIsoString(attempt.discussionStartedAt),
        scaffoldingRequestedAt: toIsoString(attempt.scaffoldingRequestedAt),
        aiResponseAt: toIsoString(attempt.aiResponseAt),
        finalAnswerAt: toIsoString(attempt.finalAnswerAt),
      },
      surveyCompleted: !!survey,
    });
  } catch (error) {
    console.error("Failed to load scenario:", error);
    return NextResponse.json({ error: "Failed to load scenario" }, { status: 500 });
  }
}

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

    const participant = await getParticipantInSession(session.id, body.participantId);

    if (body.action === "submit") {
      const finalAnswer = String(body.finalAnswer ?? "").trim();
      const ownWordsExplanation = String(body.ownWordsExplanation ?? "").trim();
      if (!finalAnswer) {
        return NextResponse.json({ error: "Final answer is required" }, { status: 400 });
      }

      const attempt = await getOrCreateAttempt(session.id, scenarioOrder);
      if (attempt.submitted) {
        return NextResponse.json({ attempt });
      }
      if (!attempt.scaffoldingType) {
        return NextResponse.json(
          { error: "Choose a scaffolding option before submitting your final answer" },
          { status: 400 }
        );
      }
      if (
        attempt.scaffoldingType === "full_answer" &&
        countWords(ownWordsExplanation) < OWN_WORDS_MIN_WORDS
      ) {
        return NextResponse.json(
          {
            error: `Explain in your own words what you understood from the AI answer (at least ${OWN_WORDS_MIN_WORDS} words)`,
          },
          { status: 400 }
        );
      }

      const updated = await submitFinalAnswer(
        session.id,
        scenarioOrder,
        finalAnswer,
        ownWordsExplanation,
        participant?.id ?? null
      );
      return NextResponse.json({ attempt: updated });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Failed to update scenario:", error);
    return NextResponse.json({ error: "Failed to update scenario" }, { status: 500 });
  }
}
