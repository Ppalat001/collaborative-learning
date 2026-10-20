import { NextResponse } from "next/server";
import { DISPLAY_NAME_MAX_LENGTH, normalizeDisplayName } from "@/lib/instruments";
import { joinSession } from "@/lib/services/sessions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const displayName = normalizeDisplayName(body.displayName);

    if (!displayName) {
      return NextResponse.json(
        { error: "Please enter your name to join the session" },
        { status: 400 }
      );
    }
    if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Names can be at most ${DISPLAY_NAME_MAX_LENGTH} characters` },
        { status: 400 }
      );
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
