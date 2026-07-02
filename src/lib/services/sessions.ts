import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { generateAnonymousId, generateSessionCode } from "@/lib/utils/codes";
import { nowIso } from "@/lib/utils/dates";
import { getScenarioByOrder, getScenarios } from "@/lib/utils/scenarios";
import { logResearchEvent } from "@/lib/utils/export";

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

export async function updateAttemptDiscussion(
  sessionId: string,
  scenarioOrder: number,
  discussionText: string,
  draftAnswer: string
) {
  const attempt = await getOrCreateAttempt(sessionId, scenarioOrder);
  const [updated] = await db
    .update(schema.scenarioAttempts)
    .set({
      discussionText,
      draftAnswer,
      updatedAt: nowIso(),
    })
    .where(eq(schema.scenarioAttempts.id, attempt.id))
    .returning();

  return updated;
}

export async function submitFinalAnswer(
  sessionId: string,
  scenarioOrder: number,
  finalAnswer: string
) {
  const attempt = await getOrCreateAttempt(sessionId, scenarioOrder);
  const scenarios = getScenarios();
  const isLast = scenarioOrder >= scenarios.length;

  const [updated] = await db
    .update(schema.scenarioAttempts)
    .set({
      finalAnswer: finalAnswer.trim(),
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

  await logResearchEvent(sessionId, "final_answer_submitted", {
    scenarioOrder,
    finalAnswerLength: finalAnswer.trim().length,
  });

  return updated;
}

export async function saveSurvey(
  sessionId: string,
  scenarioId: string,
  ratings: {
    autonomyRating: number;
    satisfactionRating: number;
    collaborationRating: number;
    perceivedHelpfulness: number;
    openReflection?: string;
  }
) {
  const [survey] = await db
    .insert(schema.surveys)
    .values({
      sessionId,
      scenarioId,
      ...ratings,
      openReflection: ratings.openReflection?.trim() || null,
    })
    .returning();

  await logResearchEvent(sessionId, "survey_submitted", {
    scenarioId,
    ...ratings,
  });

  return survey;
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
