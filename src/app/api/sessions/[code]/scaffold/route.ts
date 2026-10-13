import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateScaffoldResponse } from "@/lib/ai/scaffold";
import { getHelpReasonLabel, isValidHelpReason } from "@/lib/instruments";
import {
  formatTranscript,
  getDiscussionMessages,
  getOrCreateAttempt,
  getParticipantInSession,
  getSessionByCode,
} from "@/lib/services/sessions";
import { logResearchEvent } from "@/lib/utils/export";
import { nowIso } from "@/lib/utils/dates";
import { getScenarioByOrder, isValidScaffoldingType } from "@/lib/utils/scenarios";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const scenarioOrder = Number(body.scenarioOrder);
    const scaffoldingType = String(body.scaffoldingType ?? "");
    const helpReason = String(body.helpReason ?? "");

    if (!Number.isInteger(scenarioOrder) || scenarioOrder < 1) {
      return NextResponse.json({ error: "Invalid scenario order" }, { status: 400 });
    }

    if (!isValidScaffoldingType(scaffoldingType)) {
      return NextResponse.json({ error: "Invalid scaffolding type" }, { status: 400 });
    }

    if (!isValidHelpReason(helpReason)) {
      return NextResponse.json(
        { error: "Choose why your group needs help before selecting AI support" },
        { status: 400 }
      );
    }

    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const scenario = getScenarioByOrder(scenarioOrder);
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const attempt = await getOrCreateAttempt(session.id, scenarioOrder);

    if (attempt.scaffoldingType) {
      return NextResponse.json(
        { error: "Scaffolding already requested for this scenario" },
        { status: 409 }
      );
    }

    const participant = await getParticipantInSession(session.id, body.participantId);
    const requestedAt = nowIso();
    const discussionText = formatTranscript(
      await getDiscussionMessages(session.id, scenarioOrder)
    );

    const result = await generateScaffoldResponse(
      scaffoldingType,
      scenario,
      discussionText,
      getHelpReasonLabel(helpReason)
    );

    const now = nowIso();
    const [updated] = await db
      .update(schema.scenarioAttempts)
      .set({
        discussionText,
        helpReason,
        scaffoldingType,
        scaffoldingRequestedBy: participant?.id ?? null,
        aiResponse: result.response,
        aiPromptSystem: result.systemPrompt,
        aiPromptUser: result.userPrompt,
        aiModel: result.model,
        aiLatencyMs: result.latencyMs,
        scaffoldingRequestedAt: requestedAt,
        aiResponseAt: now,
        updatedAt: now,
      })
      .where(eq(schema.scenarioAttempts.id, attempt.id))
      .returning();

    await logResearchEvent(
      session.id,
      "scaffolding_requested",
      {
        scenarioOrder,
        scaffoldingType,
        helpReason,
        mocked: result.mocked,
        model: result.model,
        latencyMs: result.latencyMs,
      },
      participant?.id
    );

    return NextResponse.json({
      scaffoldingType,
      helpReason,
      aiResponse: result.response,
      mocked: result.mocked,
      model: result.model,
      attempt: {
        id: updated.id,
        scaffoldingType: updated.scaffoldingType,
        aiResponse: updated.aiResponse,
      },
    });
  } catch (error) {
    console.error("Scaffold error:", error);
    return NextResponse.json({ error: "Failed to generate scaffolding" }, { status: 500 });
  }
}
