import { NextResponse } from "next/server";
import { conditionManager } from "@/lib/intervention/ResearchConditionManager";
import { eligibilityGuard } from "@/lib/intervention/ResearchEligibilityGuard";
import { getSessionWithParticipants } from "@/lib/services/sessions";
import { publicStudyInfo } from "@/lib/services/studyV2";
import { toIsoString } from "@/lib/utils/dates";
import { getScenarios } from "@/lib/utils/scenarios";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const data = await getSessionWithParticipants(code);

    if (!data) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const assignment = await conditionManager.getAssignment(data.session.id);
    const readiness = assignment
      ? await eligibilityGuard.getReadinessStatus(data.session.id, assignment)
      : null;

    return NextResponse.json({
      session: {
        id: data.session.id,
        code: data.session.code,
        currentScenarioIndex: data.session.currentScenarioIndex,
        maxParticipants: data.session.maxParticipants,
        consentGiven: data.session.consentGiven,
        completedAt: toIsoString(data.session.completedAt),
        participantCount: data.participants.length,
      },
      participants: data.participants.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        anonymousId: p.anonymousId,
        joinedAt: toIsoString(p.joinedAt) ?? "",
      })),
      totalScenarios: getScenarios().length,
      v2:
        assignment && readiness
          ? {
              ...publicStudyInfo(assignment),
              readiness: {
                canStart: readiness.canStart,
                started: readiness.started,
                blockers: readiness.blockers,
                activeMemberCount: readiness.activeMemberCount,
                members: readiness.members.map((m) => ({
                  id: m.id,
                  name: m.name,
                  consented: m.consented,
                  withdrawn: m.withdrawn,
                  droppedOut: m.droppedOut,
                  preTestCompleted: m.preTestCompleted,
                  inFrozenRoster: m.inFrozenRoster,
                })),
              },
            }
          : null,
    });
  } catch (error) {
    console.error("Failed to fetch session:", error);
    return NextResponse.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}
