import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { secondsBetween, toIsoString } from "@/lib/utils/dates";

export async function logResearchEvent(
  sessionId: string,
  eventType: string,
  payload?: Record<string, unknown>,
  participantId?: string
) {
  await db.insert(schema.researchEvents).values({
    sessionId,
    participantId: participantId ?? null,
    eventType,
    payload: payload ?? null,
  });
}

export interface ExportRow {
  session_code: string;
  session_id: string;
  scenario_id: string;
  scenario_order: number;
  scaffolding_type: string;
  discussion_length: number;
  discussion_text: string;
  draft_answer: string;
  ai_response: string;
  final_answer: string;
  time_before_ai_seconds: number | null;
  ai_model: string;
  ai_latency_ms: number | null;
  autonomy_rating: number | null;
  satisfaction_rating: number | null;
  collaboration_rating: number | null;
  perceived_helpfulness: number | null;
  open_reflection: string;
  discussion_started_at: string;
  scaffolding_requested_at: string;
  ai_response_at: string;
  final_answer_at: string;
}

export async function buildExportRows(): Promise<ExportRow[]> {
  const attempts = await db
    .select({
      attempt: schema.scenarioAttempts,
      session: schema.sessions,
    })
    .from(schema.scenarioAttempts)
    .innerJoin(
      schema.sessions,
      eq(schema.scenarioAttempts.sessionId, schema.sessions.id)
    );

  const allSurveys = await db.select().from(schema.surveys);
  const surveyMap = new Map(
    allSurveys.map((s) => [`${s.sessionId}:${s.scenarioId}`, s])
  );

  return attempts.map(({ attempt, session }) => {
    const survey = surveyMap.get(`${attempt.sessionId}:${attempt.scenarioId}`);
    const timeBeforeAi = secondsBetween(
      attempt.discussionStartedAt,
      attempt.scaffoldingRequestedAt
    );

    return {
      session_code: session.code,
      session_id: session.id,
      scenario_id: attempt.scenarioId,
      scenario_order: attempt.scenarioOrder,
      scaffolding_type: attempt.scaffoldingType ?? "",
      discussion_length: attempt.discussionText.length,
      discussion_text: attempt.discussionText,
      draft_answer: attempt.draftAnswer,
      ai_response: attempt.aiResponse ?? "",
      final_answer: attempt.finalAnswer,
      time_before_ai_seconds: timeBeforeAi,
      ai_model: attempt.aiModel ?? "",
      ai_latency_ms: attempt.aiLatencyMs,
      autonomy_rating: survey?.autonomyRating ?? null,
      satisfaction_rating: survey?.satisfactionRating ?? null,
      collaboration_rating: survey?.collaborationRating ?? null,
      perceived_helpfulness: survey?.perceivedHelpfulness ?? null,
      open_reflection: survey?.openReflection ?? "",
      discussion_started_at: toIsoString(attempt.discussionStartedAt) ?? "",
      scaffolding_requested_at:
        toIsoString(attempt.scaffoldingRequestedAt) ?? "",
      ai_response_at: toIsoString(attempt.aiResponseAt) ?? "",
      final_answer_at: toIsoString(attempt.finalAnswerAt) ?? "",
    };
  });
}

export function rowsToCsv(rows: ExportRow[]): string {
  if (rows.length === 0) {
    return Object.keys(emptyRow()).join(",");
  }

  const headers = Object.keys(rows[0]) as (keyof ExportRow)[];
  const escape = (value: unknown) => {
    const str = value === null || value === undefined ? "" : String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];
  return lines.join("\n");
}

function emptyRow(): ExportRow {
  return {
    session_code: "",
    session_id: "",
    scenario_id: "",
    scenario_order: 0,
    scaffolding_type: "",
    discussion_length: 0,
    discussion_text: "",
    draft_answer: "",
    ai_response: "",
    final_answer: "",
    time_before_ai_seconds: null,
    ai_model: "",
    ai_latency_ms: null,
    autonomy_rating: null,
    satisfaction_rating: null,
    collaboration_rating: null,
    perceived_helpfulness: null,
    open_reflection: "",
    discussion_started_at: "",
    scaffolding_requested_at: "",
    ai_response_at: "",
    final_answer_at: "",
  };
}

export interface AssessmentExportRow {
  session_code: string;
  session_id: string;
  participant_id: string;
  anonymous_id: string;
  display_name: string;
  assessment_type: string;
  score: number;
  max_score: number;
  completed_at: string;
}

export async function buildAssessmentExportRows(): Promise<AssessmentExportRow[]> {
  const rows = await db
    .select({
      assessment: schema.assessments,
      session: schema.sessions,
      participant: schema.participants,
    })
    .from(schema.assessments)
    .innerJoin(schema.sessions, eq(schema.assessments.sessionId, schema.sessions.id))
    .leftJoin(
      schema.participants,
      eq(schema.assessments.participantId, schema.participants.id)
    );

  return rows.map(({ assessment, session, participant }) => ({
    session_code: session.code,
    session_id: session.id,
    participant_id: assessment.participantId ?? "",
    anonymous_id: participant?.anonymousId ?? "",
    display_name: participant?.displayName ?? "",
    assessment_type: assessment.assessmentType,
    score: assessment.score,
    max_score: assessment.maxScore,
    completed_at: toIsoString(assessment.completedAt) ?? "",
  }));
}

export function assessmentRowsToCsv(rows: AssessmentExportRow[]): string {
  if (rows.length === 0) {
    return "session_code,session_id,participant_id,anonymous_id,display_name,assessment_type,score,max_score,completed_at";
  }
  const headers = Object.keys(rows[0]) as (keyof AssessmentExportRow)[];
  const escape = (value: unknown) => {
    const str = value === null || value === undefined ? "" : String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");
}
