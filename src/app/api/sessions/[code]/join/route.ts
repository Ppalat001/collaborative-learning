import { NextResponse } from "next/server";
import { joinSession } from "@/lib/services/sessions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const displayName = String(body.displayName ?? "").trim();

    if (!displayName) {
      return NextResponse.json({ error: "Display name is required" }, { status: 400 });
    }

    const result = await joinSession(code, displayName);
    return NextResponse.json({
      session: {
        id: result.session.id,
        code: result.session.code,
        consentGiven: result.session.consentGiven,
      },
      participant: {
        id: result.participant.id,
        displayName: result.participant.displayName,
        anonymousId: result.participant.anonymousId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to join session";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
