import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { RUBRIC_CRITERIA } from "@/lib/instruments";
import { getSessionByCode } from "@/lib/services/sessions";
import { isAdminRequest } from "@/lib/utils/admin";
import { nowIso } from "@/lib/utils/dates";
import { getScenarioById } from "@/lib/utils/scenarios";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const rater = searchParams.get("rater")?.trim() ?? "";
    const code = searchParams.get("session")?.trim().toUpperCase() ?? "";
    if (!code) {
      return NextResponse.json({ error: "Enter a group ID" }, { status: 400 });
    }
    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: `Group ${code} not found` }, { status: 404 });
    }

    const [members, attempts, scaffolds] = await Promise.all([
      db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.sessionId, session.id))
        .orderBy(asc(schema.participants.joinedAt)),
      db
        .select()
        .from(schema.scenarioAttempts)
        .where(
          and(
            eq(schema.scenarioAttempts.sessionId, session.id),
            eq(schema.scenarioAttempts.submitted, true)
          )
        )
        .orderBy(asc(schema.scenarioAttempts.scenarioOrder)),
      db
        .select()
        .from(schema.individualScaffolds)
        .where(eq(schema.individualScaffolds.sessionId, session.id)),
    ]);
    const attemptIds = attempts.map((attempt) => attempt.id);
    const scores =
      rater && attemptIds.length > 0
        ? await db
            .select()
            .from(schema.rubricScores)
            .where(
              and(
                eq(schema.rubricScores.rater, rater),
                inArray(schema.rubricScores.attemptId, attemptIds)
              )
            )
        : [];

    return NextResponse.json({
      sessionCode: session.code,
      members: members.map((member) => ({ id: member.id, name: member.displayName })),
      attempts: attempts.map((attempt) => {
        const scenario = getScenarioById(attempt.scenarioId);
        return {
          id: attempt.id,
          scenarioOrder: attempt.scenarioOrder,
          scenarioTitle: scenario?.title ?? attempt.scenarioId,
          scenarioDescription: scenario?.description ?? "",
          support: members.map((member) => ({
            participantId: member.id,
            requests: scaffolds
              .filter(
                (s) =>
                  s.participantId === member.id && s.scenarioOrder === attempt.scenarioOrder
              )
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((s) => ({ type: s.scaffoldingType, selected: s.selected })),
          })),
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
