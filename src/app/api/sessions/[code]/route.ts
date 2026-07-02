import { NextResponse } from "next/server";
import { getSessionWithParticipants } from "@/lib/services/sessions";
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
    });
  } catch (error) {
    console.error("Failed to fetch session:", error);
    return NextResponse.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}
