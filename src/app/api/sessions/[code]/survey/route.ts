import { NextResponse } from "next/server";
import { getSessionByCode, saveSurvey } from "@/lib/services/sessions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const session = await getSessionByCode(code);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const survey = await saveSurvey(session.id, String(body.scenarioId), {
      autonomyRating: Number(body.autonomyRating),
      satisfactionRating: Number(body.satisfactionRating),
      collaborationRating: Number(body.collaborationRating),
      perceivedHelpfulness: Number(body.perceivedHelpfulness),
      openReflection: body.openReflection ? String(body.openReflection) : undefined,
    });

    return NextResponse.json({ survey });
  } catch (error) {
    console.error("Survey error:", error);
    return NextResponse.json({ error: "Failed to save survey" }, { status: 500 });
  }
}
