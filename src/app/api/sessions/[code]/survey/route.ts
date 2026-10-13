import { NextResponse } from "next/server";
import {
  getOrCreateAttempt,
  getParticipantInSession,
  getSessionByCode,
  saveSurvey,
  type SurveyRatings,
} from "@/lib/services/sessions";
import { SURVEY_ITEMS, isValidSupportAmount } from "@/lib/instruments";
import { getScenarioById } from "@/lib/utils/scenarios";

function parseRating(value: unknown): number | null {
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

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

    const participant = await getParticipantInSession(session.id, body.participantId);
    if (!participant) {
      return NextResponse.json(
        { error: "Each rating must come from a participant in this session" },
        { status: 400 }
      );
    }

    const scenario = getScenarioById(String(body.scenarioId));
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const attempt = await getOrCreateAttempt(session.id, scenario.order);
    const aiUsed = !!attempt.scaffoldingType && attempt.scaffoldingType !== "no_assistance";

    const ratings: SurveyRatings = {
      supportAmount: null,
      openReflection: body.openReflection ? String(body.openReflection) : undefined,
    };

    for (const item of SURVEY_ITEMS) {
      if (item.aiOnly && !aiUsed) {
        ratings[item.key] = null;
        continue;
      }
      const rating = parseRating(body[item.key]);
      if (rating === null && !item.allowNotApplicable) {
        return NextResponse.json(
          { error: `Missing rating: ${item.label}` },
          { status: 400 }
        );
      }
      ratings[item.key] = rating;
    }

    if (aiUsed) {
      const supportAmount = String(body.supportAmount ?? "");
      if (!isValidSupportAmount(supportAmount)) {
        return NextResponse.json(
          { error: "Say whether the AI support was too little, about right, or too much" },
          { status: 400 }
        );
      }
      ratings.supportAmount = supportAmount;
    }

    const survey = await saveSurvey(session.id, scenario.id, participant.id, ratings);
    return NextResponse.json({ survey });
  } catch (error) {
    console.error("Survey error:", error);
    return NextResponse.json({ error: "Failed to save survey" }, { status: 500 });
  }
}
