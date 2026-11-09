import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/auth/routeAuth";
import {
  isOpenRubricEnabled,
  OPEN_RUBRIC_CRITERIA,
  OPEN_RUBRIC_VERSION,
} from "@/lib/intervention/learning/OpenAnswerRubric";
import { listOpenAnswers, saveOpenRubricScore } from "@/lib/intervention/learning/OpenAnswerRubricService";
import { getSessionByCode } from "@/lib/services/sessions";
import { isAdminRequest } from "@/lib/utils/admin";

const disabled = () =>
  NextResponse.json(
    { error: "The open-answer rubric is off. Set ADAPTIVE_V2_OPEN_ANSWER_RUBRIC=true to use it." },
    { status: 404 }
  );

/**
 * Optional researcher rubric for written question 9 (admin only, off by default).
 * GET ?session=CODE&blind=true: answers and existing scores. POST { session, assessmentId, raterId, criteria }.
 * Kept apart from the unchanged multiple-choice score.
 */
export async function GET(request: Request) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOpenRubricEnabled()) return disabled();
  try {
    const params = new URL(request.url).searchParams;
    const code = params.get("session")?.trim().toUpperCase();
    if (!code) return NextResponse.json({ error: "Choose a group" }, { status: 400 });
    const session = await getSessionByCode(code);
    if (!session) return NextResponse.json({ error: `Group ${code} not found` }, { status: 404 });
    return NextResponse.json({
      rubricVersion: OPEN_RUBRIC_VERSION,
      criteria: OPEN_RUBRIC_CRITERIA,
      answers: listOpenAnswers({ sessionId: session.id, blind: params.get("blind") !== "false" }),
    });
  } catch (error) {
    return errorResponse(error, "Failed to load written answers");
  }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOpenRubricEnabled()) return disabled();
  try {
    const body = await request.json();
    const code = typeof body.session === "string" ? body.session.trim().toUpperCase() : "";
    if (!code) return NextResponse.json({ error: "Choose a group" }, { status: 400 });
    const session = await getSessionByCode(code);
    if (!session) return NextResponse.json({ error: `Group ${code} not found` }, { status: 404 });
    const score = saveOpenRubricScore({ sessionId: session.id, body });
    return NextResponse.json({ score });
  } catch (error) {
    return errorResponse(error, "Failed to save the rubric score");
  }
}
