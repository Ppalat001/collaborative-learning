import { NextResponse } from "next/server";
import { generateScaffoldResponse } from "@/lib/ai/scaffold";
import {
  formatTranscript,
  getDiscussionMessages,
  getIndividualScaffold,
  getOrCreateAttempt,
  getParticipantInSession,
  getSessionByCode,
  saveIndividualScaffold,
  setIndividualScaffoldSelected,
  toIndividualScaffold,
} from "@/lib/services/sessions";
import { logResearchEvent } from "@/lib/utils/export";
import { getScenarioByOrder, isValidScaffoldingType } from "@/lib/utils/scenarios";

/**
 * AI support is individual: each member switches support types on ("select") or
 * off ("unselect") for themselves. A type's response is generated the first time
 * it is selected and reused afterwards, so toggling never calls the AI again.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const action = String(body.action ?? "");
    const scenarioOrder = Number(body.scenarioOrder);
    const scaffoldingType = String(body.scaffoldingType ?? "");

    if (action !== "select" && action !== "unselect") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    if (!Number.isInteger(scenarioOrder) || scenarioOrder < 1) {
      return NextResponse.json({ error: "Invalid scenario order" }, { status: 400 });
    }
    if (!isValidScaffoldingType(scaffoldingType) || scaffoldingType === "no_assistance") {
      return NextResponse.json({ error: "Invalid support type" }, { status: 400 });
    }

    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const scenario = getScenarioByOrder(scenarioOrder);
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }
    const participant = await getParticipantInSession(session.id, body.participantId);
    if (!participant) {
      return NextResponse.json(
        { error: "Join the session on this device before choosing AI support" },
        { status: 403 }
      );
    }

    const existing = await getIndividualScaffold(participant.id, scenarioOrder, scaffoldingType);

    if (action === "unselect") {
      if (!existing) return NextResponse.json({ scaffold: null });
      const updated = await setIndividualScaffoldSelected(existing, false);
      if (existing.selected) {
        await logResearchEvent(
          session.id,
          "ai_support_unselected",
          { scenarioOrder, scaffoldingType },
          participant.id
        );
      }
      return NextResponse.json({ scaffold: toIndividualScaffold(updated) });
    }

    if (existing) {
      const updated = await setIndividualScaffoldSelected(existing, true);
      if (!existing.selected) {
        await logResearchEvent(
          session.id,
          "ai_support_reselected",
          { scenarioOrder, scaffoldingType },
          participant.id
        );
      }
      return NextResponse.json({ scaffold: toIndividualScaffold(updated), cached: true });
    }

    const attempt = await getOrCreateAttempt(session.id, scenarioOrder);
    if (attempt.submitted) {
      return NextResponse.json(
        { error: "This scenario is finished, so no new AI support can be requested" },
        { status: 409 }
      );
    }

    const discussionText = formatTranscript(
      await getDiscussionMessages(session.id, scenarioOrder)
    );

    let result: Awaited<ReturnType<typeof generateScaffoldResponse>>;
    try {
      result = await generateScaffoldResponse(
        scaffoldingType,
        scenario,
        discussionText,
        attempt.finalAnswer
      );
    } catch (error) {
      console.error("AI generation failed:", error);
      return NextResponse.json(
        { error: "The AI could not respond. Please try selecting it again." },
        { status: 502 }
      );
    }

    const row = await saveIndividualScaffold({
      sessionId: session.id,
      participantId: participant.id,
      scenarioOrder,
      scaffoldingType,
      aiResponse: result.response,
      aiPromptSystem: result.systemPrompt,
      aiPromptUser: result.userPrompt,
      aiModel: result.model,
      aiLatencyMs: result.latencyMs,
    });

    await logResearchEvent(
      session.id,
      "ai_support_requested",
      {
        scenarioOrder,
        scaffoldingType,
        mocked: result.mocked,
        model: result.model,
        latencyMs: result.latencyMs,
        chatMessagesBefore: discussionText ? discussionText.split("\n").length : 0,
      },
      participant.id
    );

    return NextResponse.json({ scaffold: toIndividualScaffold(row), cached: false });
  } catch (error) {
    console.error("Scaffold error:", error);
    return NextResponse.json({ error: "Failed to process AI support request" }, { status: 500 });
  }
}
