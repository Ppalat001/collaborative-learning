import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateAnonymousId, generateSessionCode } from "@/lib/utils/codes";
import { nowIso } from "@/lib/utils/dates";
import { getScenarioByOrder, getScenarios } from "@/lib/utils/scenarios";
import { logResearchEvent } from "@/lib/utils/export";
import { normalizeRuns } from "@/lib/authorship";
import {
  ANSWER_WORD_LIMIT,
  countWords,
  type SharedField,
  type SurveyRatingKey,
} from "@/lib/instruments";
import type {
  AuthorRun,
  DiscussionMessage,
  GroupMember,
  IndividualScaffold,
  ScaffoldingType,
} from "@/lib/types";

export async function createSession() {
  const code = generateSessionCode();
  const [session] = await db
    .insert(schema.sessions)
    .values({ code })
    .returning();

  await logResearchEvent(session.id, "session_created", { code });

  return session;
}

export async function getSessionByCode(code: string) {
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.code, code.toUpperCase()))
    .limit(1);

  return session ?? null;
}

export async function getSessionWithParticipants(code: string) {
  const session = await getSessionByCode(code);
  if (!session) return null;

  const members = await db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.sessionId, session.id))
    .orderBy(asc(schema.participants.joinedAt));

  return { session, participants: members };
}

export async function joinSession(
  code: string,
  displayName: string
) {
  const session = await getSessionByCode(code);
  if (!session) {
    throw new Error("Session not found");
  }

  const members = await db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.sessionId, session.id));

  if (members.length >= session.maxParticipants) {
    throw new Error("Session is full (maximum 4 participants)");
  }

  const name = displayName.trim();
  if (members.some((m) => m.displayName.toLowerCase() === name.toLowerCase())) {
    throw new Error(
      `Someone in this group already uses the name "${name}". Please use a different name.`
    );
  }

  const anonymousId = generateAnonymousId();
  const [participant] = await db
    .insert(schema.participants)
    .values({
      sessionId: session.id,
      displayName: name,
      anonymousId,
    })
    .returning();

  await logResearchEvent(session.id, "participant_joined", {
    anonymousId,
    displayName: name,
  }, participant.id);

  return { session, participant };
}

export async function setSessionConsent(code: string) {
  const session = await getSessionByCode(code);
  if (!session) throw new Error("Session not found");

  const [updated] = await db
    .update(schema.sessions)
    .set({ consentGiven: true })
    .where(eq(schema.sessions.id, session.id))
    .returning();

  await logResearchEvent(session.id, "consent_given");
  return updated;
}

export async function getOrCreateAttempt(sessionId: string, scenarioOrder: number) {
  const scenario = getScenarioByOrder(scenarioOrder);
  if (!scenario) throw new Error("Scenario not found");

  const [existing] = await db
    .select()
    .from(schema.scenarioAttempts)
    .where(
      and(
        eq(schema.scenarioAttempts.sessionId, sessionId),
        eq(schema.scenarioAttempts.scenarioOrder, scenarioOrder)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [attempt] = await db
    .insert(schema.scenarioAttempts)
    .values({
      sessionId,
      scenarioId: scenario.id,
      scenarioOrder,
      discussionStartedAt: nowIso(),
    })
    .returning();

  await logResearchEvent(sessionId, "scenario_started", {
    scenarioId: scenario.id,
    scenarioOrder,
  });

  return attempt;
}

export async function getParticipantInSession(
  sessionId: string,
  participantId: string | null | undefined
) {
  if (!participantId) return null;
  const [participant] = await db
    .select()
    .from(schema.participants)
    .where(
      and(
        eq(schema.participants.id, participantId),
        eq(schema.participants.sessionId, sessionId)
      )
    )
    .limit(1);
  return participant ?? null;
}

export async function getSessionMembers(sessionId: string) {
  return db
    .select()
    .from(schema.participants)
    .where(eq(schema.participants.sessionId, sessionId))
    .orderBy(asc(schema.participants.joinedAt));
}

function toDiscussionMessage(
  message: typeof schema.discussionMessages.$inferSelect,
  members: (typeof schema.participants.$inferSelect)[]
): DiscussionMessage {
  const index = members.findIndex((m) => m.id === message.participantId);
  return {
    id: message.id,
    participantId: message.participantId,
    authorName: index >= 0 ? members[index].displayName : "Unknown",
    colorIndex: index >= 0 ? index : -1,
    text: message.text,
    createdAt: message.createdAt,
  };
}

export async function getDiscussionMessages(
  sessionId: string,
  scenarioOrder: number
): Promise<DiscussionMessage[]> {
  const [messages, members] = await Promise.all([
    db
      .select()
      .from(schema.discussionMessages)
      .where(
        and(
          eq(schema.discussionMessages.sessionId, sessionId),
          eq(schema.discussionMessages.scenarioOrder, scenarioOrder)
        )
      )
      .orderBy(asc(schema.discussionMessages.createdAt)),
    getSessionMembers(sessionId),
  ]);
  return messages.map((message) => toDiscussionMessage(message, members));
}

export function formatTranscript(messages: DiscussionMessage[]): string {
  return messages.map((m) => `${m.authorName}: ${m.text}`).join("\n");
}

export async function addDiscussionMessage(
  sessionId: string,
  scenarioOrder: number,
  participantId: string,
  text: string
): Promise<DiscussionMessage | null> {
  const attempt = await getOrCreateAttempt(sessionId, scenarioOrder);
  if (attempt.submitted) return null;

  const [message] = await db
    .insert(schema.discussionMessages)
    .values({ sessionId, participantId, scenarioOrder, text })
    .returning();

  return toDiscussionMessage(message, await getSessionMembers(sessionId));
}

type Member = typeof schema.participants.$inferSelect;

export function toGroupMembers(members: Member[]): GroupMember[] {
  return members.map((m, index) => ({ id: m.id, name: m.displayName, colorIndex: index }));
}

type ScaffoldRow = typeof schema.individualScaffolds.$inferSelect;

const scaffoldWhere = (participantId: string, scenarioOrder: number) =>
  and(
    eq(schema.individualScaffolds.participantId, participantId),
    eq(schema.individualScaffolds.scenarioOrder, scenarioOrder)
  );

export function toIndividualScaffold(row: ScaffoldRow): IndividualScaffold {
  return {
    scaffoldingType: row.scaffoldingType as ScaffoldingType,
    aiResponse: row.aiResponse,
    selected: row.selected,
  };
}

/** A participant's own AI responses for a scenario, in the order they first asked for them. */
export async function getIndividualScaffolds(participantId: string, scenarioOrder: number) {
  return db
    .select()
    .from(schema.individualScaffolds)
    .where(scaffoldWhere(participantId, scenarioOrder))
    .orderBy(asc(schema.individualScaffolds.createdAt));
}

export async function getIndividualScaffold(
  participantId: string,
  scenarioOrder: number,
  scaffoldingType: ScaffoldingType
) {
  const [row] = await db
    .select()
    .from(schema.individualScaffolds)
    .where(
      and(
        scaffoldWhere(participantId, scenarioOrder),
        eq(schema.individualScaffolds.scaffoldingType, scaffoldingType)
      )
    )
    .limit(1);
  return row ?? null;
}

/** Stores a freshly generated response; if a parallel request stored one first, that one wins. */
export async function saveIndividualScaffold(
  values: typeof schema.individualScaffolds.$inferInsert
): Promise<ScaffoldRow> {
  await db.insert(schema.individualScaffolds).values(values).onConflictDoNothing();
  const row = await getIndividualScaffold(
    values.participantId,
    values.scenarioOrder,
    values.scaffoldingType as ScaffoldingType
  );
  if (!row) throw new Error("Failed to store AI support");
  return row;
}

/** Shows or hides an already generated response without calling the AI again. */
export async function setIndividualScaffoldSelected(row: ScaffoldRow, selected: boolean) {
  if (row.selected === selected) return row;
  const [updated] = await db
    .update(schema.individualScaffolds)
    .set({
      selected,
      timesSelected: row.timesSelected + (selected ? 1 : 0),
      timesUnselected: row.timesUnselected + (selected ? 0 : 1),
      lastToggledAt: nowIso(),
    })
    .where(eq(schema.individualScaffolds.id, row.id))
    .returning();
  return updated;
}

export interface EditBatch {
  field: SharedField;
  charsAdded: number;
  charsRemoved: number;
  insertedText: string;
}

type UpdateResult =
  | { ok: true; attempt: typeof schema.scenarioAttempts.$inferSelect }
  | { ok: false; error: string; status: number };

export async function updateAttemptFields(
  sessionId: string,
  scenarioOrder: number,
  fields: Partial<Record<SharedField, string>>,
  authorship: AuthorRun[] | null,
  edits: EditBatch[],
  participantId: string | null
): Promise<UpdateResult> {
  const attempt = await getOrCreateAttempt(sessionId, scenarioOrder);
  if (attempt.submitted) {
    return { ok: false, error: "This answer was already submitted", status: 409 };
  }
  if (participantId && (attempt.readyParticipantIds ?? []).includes(participantId)) {
    return { ok: false, error: "Unselect \"I am good\" before editing", status: 409 };
  }
  if (fields.finalAnswer !== undefined && countWords(fields.finalAnswer) > ANSWER_WORD_LIMIT) {
    return { ok: false, error: `The answer is limited to ${ANSWER_WORD_LIMIT} words`, status: 400 };
  }

  const changes: Partial<typeof schema.scenarioAttempts.$inferInsert> = {
    ...fields,
    updatedAt: nowIso(),
  };
  if (fields.finalAnswer !== undefined) {
    changes.finalAnswerAuthorship = normalizeRuns(authorship, fields.finalAnswer.length);
  }

  const [updated] = await db
    .update(schema.scenarioAttempts)
    .set(changes)
    .where(eq(schema.scenarioAttempts.id, attempt.id))
    .returning();

  const meaningfulEdits = edits.filter(
    (edit) => edit.charsAdded > 0 || edit.charsRemoved > 0
  );
  if (meaningfulEdits.length > 0) {
    await db.insert(schema.editEvents).values(
      meaningfulEdits.map((edit) => ({
        sessionId,
        participantId,
        scenarioOrder,
        field: edit.field,
        charsAdded: edit.charsAdded,
        charsRemoved: edit.charsRemoved,
        insertedText: edit.insertedText,
      }))
    );
  }

  return { ok: true, attempt: updated };
}

export interface ReadyState {
  readyIds: string[];
  submitted: boolean;
}

/**
 * Records a member's "I am good". The answer is submitted only when every member
 * of the session is ready; the check and the write share one transaction so two
 * members clicking together cannot both miss (or both trigger) the submission.
 */
export async function setParticipantReady(
  sessionId: string,
  scenarioOrder: number,
  participantId: string,
  ready: boolean
): Promise<{ ok: true; value: ReadyState } | { ok: false; error: string; status: number }> {
  const attempt = await getOrCreateAttempt(sessionId, scenarioOrder);
  const memberIds = (await getSessionMembers(sessionId)).map((m) => m.id);
  const isLast = scenarioOrder >= getScenarios().length;
  const now = nowIso();

  const result = db.transaction((tx) => {
    const current = tx
      .select()
      .from(schema.scenarioAttempts)
      .where(eq(schema.scenarioAttempts.id, attempt.id))
      .get();
    if (!current) return { ok: false as const, error: "Scenario not found", status: 404 };
    const previous = current.readyParticipantIds ?? [];
    if (current.submitted) {
      return {
        ok: true as const,
        value: { readyIds: previous, submitted: true, answer: null as string | null },
      };
    }
    if (ready && !current.finalAnswer.trim()) {
      return {
        ok: false as const,
        error: "Write the group answer before selecting \"I am good\"",
        status: 400,
      };
    }

    const readyIds = ready
      ? Array.from(new Set([...previous, participantId]))
      : previous.filter((id) => id !== participantId);
    const everyoneReady = memberIds.length > 0 && memberIds.every((id) => readyIds.includes(id));

    tx.update(schema.scenarioAttempts)
      .set({
        readyParticipantIds: readyIds,
        updatedAt: now,
        ...(everyoneReady
          ? { submitted: true, submittedBy: participantId, finalAnswerAt: now }
          : {}),
      })
      .where(eq(schema.scenarioAttempts.id, attempt.id))
      .run();

    if (everyoneReady) {
      tx.update(schema.sessions)
        .set(
          isLast
            ? { completedAt: now, currentScenarioIndex: scenarioOrder }
            : { currentScenarioIndex: scenarioOrder }
        )
        .where(eq(schema.sessions.id, sessionId))
        .run();
    }

    return {
      ok: true as const,
      value: { readyIds, submitted: everyoneReady, answer: current.finalAnswer as string | null },
    };
  });

  if (!result.ok) return result;
  const { readyIds, submitted, answer } = result.value;
  if (answer === null) return { ok: true, value: { readyIds, submitted } };

  await logResearchEvent(
    sessionId,
    ready ? "participant_ready" : "participant_unready",
    { scenarioOrder, readyCount: readyIds.length, memberCount: memberIds.length },
    participantId
  );
  if (submitted) {
    await logResearchEvent(
      sessionId,
      "final_answer_submitted",
      { scenarioOrder, finalAnswerWords: countWords(answer) },
      participantId
    );
  }
  return { ok: true, value: { readyIds, submitted } };
}

export async function getParticipantSurvey(
  sessionId: string,
  scenarioId: string,
  participantId: string
) {
  const [survey] = await db
    .select()
    .from(schema.surveys)
    .where(
      and(
        eq(schema.surveys.sessionId, sessionId),
        eq(schema.surveys.scenarioId, scenarioId),
        eq(schema.surveys.participantId, participantId)
      )
    )
    .limit(1);
  return survey ?? null;
}

export type SurveyRatings = Partial<Record<SurveyRatingKey, number | null>> & {
  supportAmount: string | null;
  openReflection?: string;
};

export async function saveSurvey(
  sessionId: string,
  scenarioId: string,
  participantId: string,
  ratings: SurveyRatings
) {
  const existing = await getParticipantSurvey(sessionId, scenarioId, participantId);
  if (existing) return existing;

  const [survey] = await db
    .insert(schema.surveys)
    .values({
      sessionId,
      scenarioId,
      participantId,
      ...ratings,
      openReflection: ratings.openReflection?.trim() || null,
    })
    .returning();

  await logResearchEvent(
    sessionId,
    "survey_submitted",
    { scenarioId, ...ratings },
    participantId
  );

  return survey;
}

export async function getFinalReflection(sessionId: string, participantId: string) {
  const [reflection] = await db
    .select()
    .from(schema.finalReflections)
    .where(
      and(
        eq(schema.finalReflections.sessionId, sessionId),
        eq(schema.finalReflections.participantId, participantId)
      )
    )
    .limit(1);
  return reflection ?? null;
}

export async function saveFinalReflection(
  sessionId: string,
  participantId: string,
  answers: Record<string, string>
) {
  const existing = await getFinalReflection(sessionId, participantId);
  if (existing) return existing;

  const [reflection] = await db
    .insert(schema.finalReflections)
    .values({ sessionId, participantId, answers })
    .returning();

  await logResearchEvent(sessionId, "final_reflection_submitted", undefined, participantId);
  return reflection;
}

export async function saveAssessment(
  sessionId: string,
  assessmentType: "pre" | "post",
  answers: Record<string, number>,
  openAnswers: Record<string, string>,
  score: number,
  maxScore: number,
  participantId?: string
) {
  if (participantId) {
    const [existing] = await db
      .select()
      .from(schema.assessments)
      .where(
        and(
          eq(schema.assessments.sessionId, sessionId),
          eq(schema.assessments.assessmentType, assessmentType),
          eq(schema.assessments.participantId, participantId)
        )
      )
      .limit(1);

    if (existing) return existing;
  }

  const [assessment] = await db
    .insert(schema.assessments)
    .values({
      sessionId,
      participantId: participantId ?? null,
      assessmentType,
      answers,
      openAnswers,
      score,
      maxScore,
    })
    .returning();

  await logResearchEvent(sessionId, "assessment_completed", {
    assessmentType,
    score,
    maxScore,
    participantId,
  }, participantId);

  return assessment;
}

export async function getParticipantAssessment(
  sessionId: string,
  participantId: string,
  assessmentType: "pre" | "post"
) {
  const [assessment] = await db
    .select()
    .from(schema.assessments)
    .where(
      and(
        eq(schema.assessments.sessionId, sessionId),
        eq(schema.assessments.participantId, participantId),
        eq(schema.assessments.assessmentType, assessmentType)
      )
    )
    .limit(1);

  return assessment ?? null;
}

/** Every group with its members and progress, newest first, for the admin page. */
export async function listSessionsForAdmin() {
  const [sessions, participants, attempts] = await Promise.all([
    db.select().from(schema.sessions),
    db.select().from(schema.participants).orderBy(asc(schema.participants.joinedAt)),
    db.select().from(schema.scenarioAttempts),
  ]);
  return sessions
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((session) => ({
      code: session.code,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      members: participants
        .filter((p) => p.sessionId === session.id)
        .map((p) => p.displayName),
      scenariosFinished: attempts.filter((a) => a.sessionId === session.id && a.submitted)
        .length,
      totalScenarios: getScenarios().length,
    }));
}

/** Deletes a group and, through cascading foreign keys, everything recorded for it. */
export async function deleteSession(sessionId: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

export async function deleteAllSessions() {
  const deleted = await db.delete(schema.sessions).returning({ id: schema.sessions.id });
  return deleted.length;
}
