import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateAnonymousId, generateSessionCode } from "@/lib/utils/codes";
import { nowIso } from "@/lib/utils/dates";
import { getScenarioByOrder, getScenarios } from "@/lib/utils/scenarios";
import { logResearchEvent } from "@/lib/utils/export";
import type { SharedField, SurveyRatingKey } from "@/lib/instruments";
import type { DiscussionMessage, ScaffoldProposal, ScaffoldingType } from "@/lib/types";

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

  const anonymousId = generateAnonymousId();
  const [participant] = await db
    .insert(schema.participants)
    .values({
      sessionId: session.id,
      displayName: displayName.trim(),
      anonymousId,
    })
    .returning();

  await logResearchEvent(session.id, "participant_joined", {
    anonymousId,
    displayName: displayName.trim(),
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
type ProposalRow = typeof schema.scaffoldProposals.$inferSelect;

export function memberName(members: Member[], participantId: string | null): string {
  return members.find((m) => m.id === participantId)?.displayName ?? "Unknown";
}

function toProposal(row: ProposalRow, members: Member[]): ScaffoldProposal {
  return {
    id: row.id,
    proposedById: row.proposedBy,
    proposedByName: memberName(members, row.proposedBy),
    helpReason: row.helpReason,
    scaffoldingType: row.scaffoldingType as ScaffoldingType,
    createdAt: row.createdAt,
  };
}

const pendingProposalWhere = (sessionId: string, scenarioOrder: number) =>
  and(
    eq(schema.scaffoldProposals.sessionId, sessionId),
    eq(schema.scaffoldProposals.scenarioOrder, scenarioOrder),
    eq(schema.scaffoldProposals.status, "pending")
  );

export async function getPendingProposal(
  sessionId: string,
  scenarioOrder: number
): Promise<ScaffoldProposal | null> {
  const [[row], members] = await Promise.all([
    db
      .select()
      .from(schema.scaffoldProposals)
      .where(pendingProposalWhere(sessionId, scenarioOrder))
      .limit(1),
    getSessionMembers(sessionId),
  ]);
  return row ? toProposal(row, members) : null;
}

type ProposalResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

/**
 * The check-and-write blocks below run as synchronous better-sqlite3
 * transactions, so two members clicking at the same moment cannot both win.
 */
export async function proposeScaffolding(
  sessionId: string,
  scenarioOrder: number,
  participantId: string,
  helpReason: string,
  scaffoldingType: ScaffoldingType
): Promise<ProposalResult<ScaffoldProposal>> {
  const attempt = await getOrCreateAttempt(sessionId, scenarioOrder);
  const members = await getSessionMembers(sessionId);

  const result = db.transaction((tx): ProposalResult<ProposalRow> => {
    const current = tx
      .select()
      .from(schema.scenarioAttempts)
      .where(eq(schema.scenarioAttempts.id, attempt.id))
      .get();
    if (current?.scaffoldingType || current?.submitted) {
      return { ok: false, error: "AI support was already chosen for this scenario", status: 409 };
    }
    const pending = tx
      .select()
      .from(schema.scaffoldProposals)
      .where(pendingProposalWhere(sessionId, scenarioOrder))
      .get();
    if (pending) {
      return {
        ok: false,
        error: "Another proposal is waiting. Agree to it or cancel it first.",
        status: 409,
      };
    }
    const row = tx
      .insert(schema.scaffoldProposals)
      .values({ sessionId, scenarioOrder, proposedBy: participantId, helpReason, scaffoldingType })
      .returning()
      .get();
    return { ok: true, value: row };
  });

  if (!result.ok) return result;
  await logResearchEvent(
    sessionId,
    "scaffolding_proposed",
    { scenarioOrder, helpReason, scaffoldingType, proposalId: result.value.id },
    participantId
  );
  return { ok: true, value: toProposal(result.value, members) };
}

export async function cancelProposal(
  sessionId: string,
  scenarioOrder: number,
  proposalId: string,
  participantId: string
): Promise<ProposalResult<ProposalRow>> {
  const resolved = db
    .update(schema.scaffoldProposals)
    .set({ status: "cancelled", resolvedBy: participantId, resolvedAt: nowIso() })
    .where(
      and(
        eq(schema.scaffoldProposals.id, proposalId),
        pendingProposalWhere(sessionId, scenarioOrder)
      )
    )
    .returning()
    .get();

  if (!resolved) {
    return { ok: false, error: "This proposal is no longer open", status: 409 };
  }
  await logResearchEvent(
    sessionId,
    "scaffolding_proposal_cancelled",
    { scenarioOrder, proposalId },
    participantId
  );
  return { ok: true, value: resolved };
}

/** Marks the proposal agreed and claims the scenario's single AI request. */
export async function agreeToProposal(
  sessionId: string,
  scenarioOrder: number,
  proposalId: string,
  participantId: string
): Promise<ProposalResult<{ proposal: ProposalRow; attemptId: string; requestedAt: string }>> {
  const attempt = await getOrCreateAttempt(sessionId, scenarioOrder);
  const members = await getSessionMembers(sessionId);
  const requestedAt = nowIso();

  return db.transaction((tx) => {
    const proposal = tx
      .select()
      .from(schema.scaffoldProposals)
      .where(
        and(
          eq(schema.scaffoldProposals.id, proposalId),
          pendingProposalWhere(sessionId, scenarioOrder)
        )
      )
      .get();
    if (!proposal) {
      return { ok: false as const, error: "This proposal is no longer open", status: 409 };
    }
    if (proposal.proposedBy === participantId && members.length > 1) {
      return {
        ok: false as const,
        error: "Another group member needs to agree to your proposal",
        status: 403,
      };
    }
    const current = tx
      .select()
      .from(schema.scenarioAttempts)
      .where(eq(schema.scenarioAttempts.id, attempt.id))
      .get();
    if (current?.scaffoldingType || current?.submitted) {
      return { ok: false as const, error: "AI support was already chosen for this scenario", status: 409 };
    }

    tx.update(schema.scaffoldProposals)
      .set({ status: "agreed", resolvedBy: participantId, resolvedAt: requestedAt })
      .where(eq(schema.scaffoldProposals.id, proposal.id))
      .run();
    tx.update(schema.scenarioAttempts)
      .set({
        helpReason: proposal.helpReason,
        scaffoldingType: proposal.scaffoldingType,
        scaffoldingRequestedBy: proposal.proposedBy,
        scaffoldingAgreedBy: participantId,
        scaffoldingRequestedAt: requestedAt,
        updatedAt: requestedAt,
      })
      .where(eq(schema.scenarioAttempts.id, attempt.id))
      .run();

    return { ok: true as const, value: { proposal, attemptId: attempt.id, requestedAt } };
  });
}

/** Undoes agreeToProposal when the AI call fails, so the group can try again. */
export function releaseAgreement(attemptId: string, proposalId: string) {
  db.transaction((tx) => {
    tx.update(schema.scaffoldProposals)
      .set({ status: "pending", resolvedBy: null, resolvedAt: null })
      .where(eq(schema.scaffoldProposals.id, proposalId))
      .run();
    tx.update(schema.scenarioAttempts)
      .set({
        helpReason: null,
        scaffoldingType: null,
        scaffoldingRequestedBy: null,
        scaffoldingAgreedBy: null,
        scaffoldingRequestedAt: null,
        updatedAt: nowIso(),
      })
      .where(eq(schema.scenarioAttempts.id, attemptId))
      .run();
  });
}

export interface EditBatch {
  field: SharedField;
  charsAdded: number;
  charsRemoved: number;
  insertedText: string;
}

export async function updateAttemptFields(
  sessionId: string,
  scenarioOrder: number,
  fields: Partial<Record<SharedField, string>>,
  edits: EditBatch[],
  participantId: string | null
) {
  const attempt = await getOrCreateAttempt(sessionId, scenarioOrder);
  if (attempt.submitted) return attempt;

  const [updated] = await db
    .update(schema.scenarioAttempts)
    .set({ ...fields, updatedAt: nowIso() })
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

  return updated;
}

export async function submitFinalAnswer(
  sessionId: string,
  scenarioOrder: number,
  finalAnswer: string,
  ownWordsExplanation: string,
  participantId: string | null
) {
  const attempt = await getOrCreateAttempt(sessionId, scenarioOrder);
  const scenarios = getScenarios();
  const isLast = scenarioOrder >= scenarios.length;

  const [updated] = await db
    .update(schema.scenarioAttempts)
    .set({
      finalAnswer: finalAnswer.trim(),
      ownWordsExplanation: ownWordsExplanation.trim(),
      submittedBy: participantId,
      finalAnswerAt: nowIso(),
      submitted: true,
      updatedAt: nowIso(),
    })
    .where(eq(schema.scenarioAttempts.id, attempt.id))
    .returning();

  if (isLast) {
    await db
      .update(schema.sessions)
      .set({ completedAt: nowIso(), currentScenarioIndex: scenarioOrder })
      .where(eq(schema.sessions.id, sessionId));
  } else {
    await db
      .update(schema.sessions)
      .set({ currentScenarioIndex: scenarioOrder })
      .where(eq(schema.sessions.id, sessionId));
  }

  await logResearchEvent(
    sessionId,
    "final_answer_submitted",
    {
      scenarioOrder,
      finalAnswerLength: finalAnswer.trim().length,
    },
    participantId ?? undefined
  );

  return updated;
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
