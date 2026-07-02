import { NextResponse } from "next/server";
import {
  getOrCreateAttempt,
  getSessionByCode,
  submitFinalAnswer,
  updateAttemptDiscussion,
} from "@/lib/services/sessions";
import { toIsoString } from "@/lib/utils/dates";
import { getScenarioByOrder } from "@/lib/utils/scenarios";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; index: string }> }
) {
  try {
    const { code, index } = await params;
    const scenarioOrder = Number(index);
    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const scenario = getScenarioByOrder(scenarioOrder);
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const attempt = await getOrCreateAttempt(session.id, scenarioOrder);

    return NextResponse.json({
      scenario,
      attempt: {
        discussionText: attempt.discussionText,
        draftAnswer: attempt.draftAnswer,
        scaffoldingType: attempt.scaffoldingType,
        aiResponse: attempt.aiResponse,
        finalAnswer: attempt.finalAnswer,
        submitted: attempt.submitted,
        discussionStartedAt: toIsoString(attempt.discussionStartedAt),
        scaffoldingRequestedAt: toIsoString(attempt.scaffoldingRequestedAt),
        aiResponseAt: toIsoString(attempt.aiResponseAt),
        finalAnswerAt: toIsoString(attempt.finalAnswerAt),
      },
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

    if (body.action === "sync") {
      const updated = await updateAttemptDiscussion(
        session.id,
        scenarioOrder,
        String(body.discussionText ?? ""),
        String(body.draftAnswer ?? "")
      );
      return NextResponse.json({ attempt: updated });
    }

    if (body.action === "submit") {
      const finalAnswer = String(body.finalAnswer ?? "").trim();
      if (!finalAnswer) {
        return NextResponse.json({ error: "Final answer is required" }, { status: 400 });
      }

      const attempt = await getOrCreateAttempt(session.id, scenarioOrder);
      if (!attempt.scaffoldingType) {
        return NextResponse.json(
          { error: "Choose a scaffolding option before submitting your final answer" },
          { status: 400 }
        );
      }

      const updated = await submitFinalAnswer(session.id, scenarioOrder, finalAnswer);
      return NextResponse.json({ attempt: updated });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Failed to update scenario:", error);
    return NextResponse.json({ error: "Failed to update scenario" }, { status: 500 });
  }
}
