import { NextResponse } from "next/server";
import {
  getSessionByCode,
  saveSurvey,
  updateAttemptDiscussion,
} from "@/lib/services/sessions";
import { getRoomState } from "@/lib/socket";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const { searchParams } = new URL(request.url);
    const scenarioOrder = Number(searchParams.get("scenarioOrder") ?? "1");
    const session = await getSessionByCode(code);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const roomState = getRoomState(code, scenarioOrder);
    return NextResponse.json({ roomState });
  } catch (error) {
    console.error("Sync GET error:", error);
    return NextResponse.json({ error: "Failed to sync" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const scenarioOrder = Number(body.scenarioOrder ?? 1);
    const discussionText = String(body.discussionText ?? "");
    const draftAnswer = String(body.draftAnswer ?? "");

    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await updateAttemptDiscussion(session.id, scenarioOrder, discussionText, draftAnswer);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Sync POST error:", error);
    return NextResponse.json({ error: "Failed to sync" }, { status: 500 });
  }
}
