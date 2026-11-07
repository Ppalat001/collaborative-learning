import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { authorizeParticipant, errorResponse } from "@/lib/auth/routeAuth";
import {
  discussionCoordinator,
  isCheckpointKind,
  isRoleId,
} from "@/lib/intervention/GroupDiscussionCoordinator";
import { EligibilityError } from "@/lib/intervention/ResearchEligibilityGuard";
import { emitToGroup } from "@/lib/realtime/emit";
import {
  getMemberDirectory,
  listCheckpointViews,
  setPrivateOptIn,
  shareIdeaWithGroup,
} from "@/lib/services/interventions";
import { getOrCreateAttempt } from "@/lib/services/sessions";
import { logResearchEvent } from "@/lib/utils/export";

const CHECKPOINT_REPEAT_SECONDS = 30;

/**
 * V2 collaboration structure (identical across conditions unless noted):
 * initial_idea, role, checkpoint, preferences (dual_adaptive), share (not baseline).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const scenarioOrder = Number(body.scenarioOrder);
    if (!Number.isInteger(scenarioOrder) || scenarioOrder < 1) {
      return NextResponse.json({ error: "Invalid scenario order" }, { status: 400 });
    }
    const auth = await authorizeParticipant(request, code, body.participantId, {
      requireScenarioAccess: true,
    });
    if (!auth.ok) return auth.response;
    const { session, assignment, participant } = auth;
    if (!assignment) {
      return NextResponse.json({ error: "Not available for this group" }, { status: 404 });
    }
    const features = assignment.features;

    switch (body.action) {
      case "initial_idea": {
        if (features.initialIdea === "off") throw new EligibilityError("Not part of this study", "feature_off", 403);
        const attempt = await getOrCreateAttempt(session.id, scenarioOrder);
        if (attempt.submitted) throw new EligibilityError("This scenario is finished", "scenario_submitted", 409);
        const usedAi = db
          .select({ id: schema.individualScaffolds.id })
          .from(schema.individualScaffolds)
          .where(
            and(
              eq(schema.individualScaffolds.participantId, participant.id),
              eq(schema.individualScaffolds.scenarioOrder, scenarioOrder)
            )
          )
          .get();
        if (usedAi) {
          throw new EligibilityError(
            "Your first idea can only be saved before you use AI support in this scenario",
            "after_ai_use",
            409
          );
        }
        const row = await discussionCoordinator.recordInitialIdea({
          sessionId: session.id,
          participantId: participant.id,
          scenarioOrder,
          text: String(body.text ?? ""),
        });
        await logResearchEvent(session.id, "initial_idea_recorded", { scenarioOrder }, participant.id);
        return NextResponse.json({ initialIdea: { submitted: true, text: row.text } });
      }

      case "role": {
        if (!features.roles) throw new EligibilityError("Not part of this study", "feature_off", 403);
        if (!isRoleId(body.role)) return NextResponse.json({ error: "Unknown role" }, { status: 400 });
        const chosen = await discussionCoordinator.chooseRole({
          sessionId: session.id,
          participantId: participant.id,
          scenarioOrder,
          role: body.role,
          rosterIds: assignment.frozenRosterIds ?? [],
        });
        await logResearchEvent(
          session.id,
          "role_chosen",
          { scenarioOrder, role: chosen.role, matchesRotation: chosen.matchesRotation },
          participant.id
        );
        const roles = (await discussionCoordinator.listRoles(session.id, scenarioOrder)).map((r) => ({
          participantId: r.participantId,
          role: r.role,
        }));
        emitToGroup(session.code, scenarioOrder, "roles:updated", { scenarioOrder, chosen: roles });
        return NextResponse.json({ chosen: roles });
      }

      case "checkpoint": {
        if (!features.checkpoints) throw new EligibilityError("Not part of this study", "feature_off", 403);
        if (!isCheckpointKind(body.kind)) return NextResponse.json({ error: "Unknown checkpoint" }, { status: 400 });
        const attempt = await getOrCreateAttempt(session.id, scenarioOrder);
        if (attempt.submitted) throw new EligibilityError("This scenario is finished", "scenario_submitted", 409);
        const existing = await listCheckpointViews(session.id, scenarioOrder);
        const recent = existing
          .filter((c) => c.kind === body.kind)
          .find((c) => Date.now() - Date.parse(c.createdAt) < CHECKPOINT_REPEAT_SECONDS * 1000);
        if (recent) return NextResponse.json({ checkpoint: recent, duplicate: true });
        const row = await discussionCoordinator.raiseCheckpoint({
          sessionId: session.id,
          participantId: participant.id,
          scenarioOrder,
          kind: body.kind,
        });
        const view = {
          id: row.id,
          scenarioOrder,
          kind: row.kind,
          text: discussionCoordinator.getReflectionCheckpoint(body.kind),
          raisedByName: getMemberDirectory(session.id).get(participant.id)?.name ?? "A member",
          createdAt: row.createdAt,
        };
        emitToGroup(session.code, scenarioOrder, "checkpoint:raised", view);
        return NextResponse.json({ checkpoint: view, duplicate: false });
      }

      case "preferences": {
        if (typeof body.privateOffersOptIn !== "boolean") {
          return NextResponse.json({ error: "privateOffersOptIn must be true or false" }, { status: 400 });
        }
        const optIn = await setPrivateOptIn(assignment, participant.id, body.privateOffersOptIn);
        return NextResponse.json({ privateOptIn: optIn });
      }

      case "share": {
        if (body.confirmed !== true) {
          return NextResponse.json({ error: "Confirm the preview before sharing" }, { status: 400 });
        }
        if (body.sourceType !== "individual_scaffold" && body.sourceType !== "intervention") {
          return NextResponse.json({ error: "Unknown source" }, { status: 400 });
        }
        const view = await shareIdeaWithGroup({
          assignment,
          session,
          participantId: participant.id,
          scenarioOrder,
          sourceType: body.sourceType,
          sourceId: String(body.sourceId ?? ""),
          sharedText: String(body.sharedText ?? ""),
        });
        return NextResponse.json({ sharedIdea: view });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error, "Request failed");
  }
}
