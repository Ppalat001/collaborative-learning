import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { EligibilityError } from "../ResearchEligibilityGuard";
import { OPEN_RUBRIC_QUESTION_ID, OPEN_RUBRIC_VERSION, scoreOpenRubric } from "./OpenAnswerRubric";

/**
 * Researcher scoring of the written pre/post question 9. Reads the stored answer;
 * never edits the assessment row, its answers or its multiple-choice score.
 * Blind mode hides pre/post and the student and shuffles the order.
 */

export function listOpenAnswers(input: { sessionId: string; blind: boolean }) {
  const participants = db.select().from(schema.participants).where(eq(schema.participants.sessionId, input.sessionId)).all();
  const anon = new Map(participants.map((p) => [p.id, p.anonymousId]));
  const scores = db
    .select()
    .from(schema.openAnswerRubricScores)
    .where(eq(schema.openAnswerRubricScores.sessionId, input.sessionId))
    .all();
  const rows = db
    .select()
    .from(schema.assessments)
    .where(eq(schema.assessments.sessionId, input.sessionId))
    .all()
    .filter((a) => typeof a.openAnswers?.[OPEN_RUBRIC_QUESTION_ID] === "string")
    .map((a) => ({
      assessmentId: a.id,
      answer: a.openAnswers![OPEN_RUBRIC_QUESTION_ID],
      ...(input.blind
        ? {}
        : { assessmentType: a.assessmentType, studentId: a.participantId ? (anon.get(a.participantId) ?? "") : "" }),
      scores: scores
        .filter((s) => s.assessmentId === a.id)
        .map((s) => ({ raterId: s.raterId, criteria: s.criteria, total: s.openApplicationRubricScore, blind: s.blind })),
    }));
  const order = (id: string) => createHash("sha256").update(`rubric|${id}`).digest("hex");
  return input.blind
    ? rows.sort((a, b) => order(a.assessmentId).localeCompare(order(b.assessmentId)))
    : rows.sort((a, b) => (a.studentId ?? "").localeCompare(b.studentId ?? "") || (a.assessmentType ?? "").localeCompare(b.assessmentType ?? ""));
}

export function saveOpenRubricScore(input: { sessionId: string; body: Record<string, unknown> }) {
  const { body } = input;
  const assessmentId = typeof body.assessmentId === "string" ? body.assessmentId : "";
  const raterId = typeof body.raterId === "string" ? body.raterId.trim().slice(0, 64) : "";
  if (!assessmentId || !raterId) throw new EligibilityError("assessmentId and raterId are required", "invalid_score", 400);
  const scored = scoreOpenRubric(body.criteria);
  if (!scored.ok) throw new EligibilityError(scored.error, "invalid_score", 400);
  const assessment = db
    .select()
    .from(schema.assessments)
    .where(and(eq(schema.assessments.id, assessmentId), eq(schema.assessments.sessionId, input.sessionId)))
    .get();
  if (!assessment || typeof assessment.openAnswers?.[OPEN_RUBRIC_QUESTION_ID] !== "string") {
    throw new EligibilityError("No written answer to question 9 for this assessment in this group", "not_found", 404);
  }
  const now = new Date().toISOString();
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 1000) : null;
  const blind = body.blind !== false;
  return db
    .insert(schema.openAnswerRubricScores)
    .values({
      sessionId: input.sessionId,
      assessmentId,
      participantId: assessment.participantId,
      assessmentType: assessment.assessmentType,
      questionId: OPEN_RUBRIC_QUESTION_ID,
      rubricVersion: OPEN_RUBRIC_VERSION,
      criteria: scored.criteria,
      openApplicationRubricScore: scored.total,
      raterId,
      blind,
      notes,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.openAnswerRubricScores.assessmentId,
        schema.openAnswerRubricScores.questionId,
        schema.openAnswerRubricScores.raterId,
      ],
      set: { criteria: scored.criteria, openApplicationRubricScore: scored.total, blind, notes, updatedAt: now },
    })
    .returning()
    .get();
}
