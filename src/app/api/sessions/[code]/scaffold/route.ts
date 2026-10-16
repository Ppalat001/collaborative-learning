import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateScaffoldResponse } from "@/lib/ai/scaffold";
import { getHelpReasonLabel, isValidHelpReason } from "@/lib/instruments";
import {
  agreeToProposal,
  cancelProposal,
  formatTranscript,
  getDiscussionMessages,
  getParticipantInSession,
  getSessionByCode,
  getSessionMembers,
  memberName,
  proposeScaffolding,
  releaseAgreement,
} from "@/lib/services/sessions";
import { logResearchEvent } from "@/lib/utils/export";
import { nowIso } from "@/lib/utils/dates";
import { getScenarioByOrder, isValidScaffoldingType } from "@/lib/utils/scenarios";
import type { ScaffoldingType } from "@/lib/types";

/**
 * AI support is a group decision: one member proposes (action "propose"),
 * another member agrees (action "agree") and only then is the AI called.
 * Any member can withdraw a pending proposal (action "cancel").
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

    if (!Number.isInteger(scenarioOrder) || scenarioOrder < 1) {
      return NextResponse.json({ error: "Invalid scenario order" }, { status: 400 });
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

    if (action === "propose") {
      const scaffoldingType = String(body.scaffoldingType ?? "");
      const helpReason = String(body.helpReason ?? "");
      if (!isValidScaffoldingType(scaffoldingType)) {
        return NextResponse.json({ error: "Invalid scaffolding type" }, { status: 400 });
      }
      if (!isValidHelpReason(helpReason)) {
        return NextResponse.json(
          { error: "Choose why your group needs help before proposing AI support" },
          { status: 400 }
        );
      }
      const result = await proposeScaffolding(
        session.id,
        scenarioOrder,
        participant.id,
        helpReason,
        scaffoldingType
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({ proposal: result.value });
    }

    const proposalId = String(body.proposalId ?? "");
    if (!proposalId) {
      return NextResponse.json({ error: "proposalId is required" }, { status: 400 });
    }

    if (action === "cancel") {
      const result = await cancelProposal(session.id, scenarioOrder, proposalId, participant.id);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({ cancelled: true, cancelledByName: participant.displayName });
    }

    if (action !== "agree") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const claim = await agreeToProposal(session.id, scenarioOrder, proposalId, participant.id);
    if (!claim.ok) {
      return NextResponse.json({ error: claim.error }, { status: claim.status });
    }

    const { proposal, attemptId, requestedAt } = claim.value;
    const scaffoldingType = proposal.scaffoldingType as ScaffoldingType;
    const discussionText = formatTranscript(
      await getDiscussionMessages(session.id, scenarioOrder)
    );

    let result: Awaited<ReturnType<typeof generateScaffoldResponse>>;
    try {
      result = await generateScaffoldResponse(
        scaffoldingType,
        scenario,
        discussionText,
        getHelpReasonLabel(proposal.helpReason)
      );
    } catch (error) {
      console.error("AI generation failed:", error);
      releaseAgreement(attemptId, proposal.id);
      return NextResponse.json(
        { error: "The AI could not respond. The proposal is still open, so try agreeing again." },
        { status: 502 }
      );
    }

    const now = nowIso();
    await db
      .update(schema.scenarioAttempts)
      .set({
        discussionText,
        aiResponse: result.response,
        aiPromptSystem: result.systemPrompt,
        aiPromptUser: result.userPrompt,
        aiModel: result.model,
        aiLatencyMs: result.latencyMs,
        aiResponseAt: now,
        updatedAt: now,
      })
      .where(eq(schema.scenarioAttempts.id, attemptId));

    await logResearchEvent(
      session.id,
      "scaffolding_requested",
      {
        scenarioOrder,
        scaffoldingType,
        helpReason: proposal.helpReason,
        proposalId: proposal.id,
        proposedBy: proposal.proposedBy,
        secondsToAgree: Math.round(
          (Date.parse(requestedAt) - Date.parse(proposal.createdAt)) / 1000
        ),
        mocked: result.mocked,
        model: result.model,
        latencyMs: result.latencyMs,
      },
      participant.id
    );

    const members = await getSessionMembers(session.id);
    return NextResponse.json({
      scaffoldingType,
      helpReason: proposal.helpReason,
      aiResponse: result.response,
      proposedByName: memberName(members, proposal.proposedBy),
      agreedByName: participant.displayName,
      mocked: result.mocked,
      model: result.model,
    });
  } catch (error) {
    console.error("Scaffold error:", error);
    return NextResponse.json({ error: "Failed to process AI support request" }, { status: 500 });
  }
}
