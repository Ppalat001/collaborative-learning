import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { RUBRIC_CRITERIA } from "@/lib/instruments";
import { isAdminRequest } from "@/lib/utils/admin";
import { nowIso } from "@/lib/utils/dates";
import { getScenarioById } from "@/lib/utils/scenarios";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rater = new URL(request.url).searchParams.get("rater")?.trim() ?? "";
    const [sessions, attempts, scaffolds, scores] = await Promise.all([
      db.select().from(schema.sessions),
      db
        .select()
        .from(schema.scenarioAttempts)
        .where(eq(schema.scenarioAttempts.submitted, true)),
      db.select().from(schema.individualScaffolds),
      rater
        ? db.select().from(schema.rubricScores).where(eq(schema.rubricScores.rater, rater))
        : Promise.resolve([]),
    ]);
    const sessionCode = new Map(sessions.map((s) => [s.id, s.code]));

    return NextResponse.json({
      attempts: attempts
        .sort(
          (a, b) =>
            a.sessionId.localeCompare(b.sessionId) || a.scenarioOrder - b.scenarioOrder
        )
        .map((attempt) => {
          const scenario = getScenarioById(attempt.scenarioId);
          return {
            id: attempt.id,
            sessionCode: sessionCode.get(attempt.sessionId) ?? "",
            scenarioOrder: attempt.scenarioOrder,
            scenarioTitle: scenario?.title ?? attempt.scenarioId,
            scenarioDescription: scenario?.description ?? "",
            aiTypesUsed: [
              ...new Set(
                scaffolds
                  .filter(
                    (s) =>
                      s.sessionId === attempt.sessionId &&
                      s.scenarioOrder === attempt.scenarioOrder
                  )
                  .map((s) => s.scaffoldingType)
              ),
            ],
            finalAnswer: attempt.finalAnswer,
            scores: scores.filter((score) => score.attemptId === attempt.id),
          };
        }),
    });
  } catch (error) {
    console.error("Rubric fetch error:", error);
    return NextResponse.json({ error: "Failed to load answers" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const attemptId = String(body.attemptId ?? "");
    const answerType = "final";
    const rater = String(body.rater ?? "").trim();
    const notes = body.notes ? String(body.notes).trim() : null;

    if (!attemptId || !rater) {
      return NextResponse.json(
        { error: "attemptId and rater are required" },
        { status: 400 }
      );
    }

    const criteria: Record<string, number> = {};
    for (const criterion of RUBRIC_CRITERIA) {
      const value = Number(body[criterion.key]);
      if (!Number.isInteger(value) || value < 1 || value > 4) {
        return NextResponse.json(
          { error: `Score ${criterion.label} from 1 to 4` },
          { status: 400 }
        );
      }
      criteria[criterion.key] = value;
    }
    const scores = criteria as Record<(typeof RUBRIC_CRITERIA)[number]["key"], number>;

    const [existing] = await db
      .select()
      .from(schema.rubricScores)
      .where(
        and(
          eq(schema.rubricScores.attemptId, attemptId),
          eq(schema.rubricScores.answerType, answerType),
          eq(schema.rubricScores.rater, rater)
        )
      )
      .limit(1);

    const [saved] = existing
      ? await db
          .update(schema.rubricScores)
          .set({ ...scores, notes, updatedAt: nowIso() })
          .where(eq(schema.rubricScores.id, existing.id))
          .returning()
      : await db
          .insert(schema.rubricScores)
          .values({ attemptId, answerType, rater, ...scores, notes })
          .returning();

    return NextResponse.json({ score: saved });
  } catch (error) {
    console.error("Rubric save error:", error);
    return NextResponse.json({ error: "Failed to save score" }, { status: 500 });
  }
}
