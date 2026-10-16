import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  FINAL_REFLECTION_QUESTIONS,
  RUBRIC_CRITERIA,
  SURVEY_ITEMS,
  getHelpReasonLabel,
  type SurveyRatingKey,
} from "@/lib/instruments";
import { getScaffoldingOption, type ScaffoldingType } from "@/lib/types";
import { secondsBetween, toIsoString } from "@/lib/utils/dates";
import { getScenarioById } from "@/lib/utils/scenarios";
import { getAssessment } from "@/lib/utils/assessment";

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

type CsvValue = string | number | null | undefined;
type CsvRow = Record<string, CsvValue>;

export function toCsv(columns: string[], rows: CsvRow[]): string {
  const escape = (value: CsvValue) => {
    const str = value === null || value === undefined ? "" : String(value);
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\n");
}

export interface CsvExport {
  columns: string[];
  rows: CsvRow[];
}

function trigrams(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) {
    grams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return grams;
}

/** Share of `text`'s three-word sequences that also appear in `source` (0–1). */
export function textOverlap(text: string, source: string): number | null {
  const textGrams = trigrams(text);
  if (textGrams.size === 0) return null;
  const sourceGrams = trigrams(source);
  let shared = 0;
  for (const gram of textGrams) if (sourceGrams.has(gram)) shared++;
  return Math.round((shared / textGrams.size) * 1000) / 1000;
}

/** Normalised Shannon entropy of contribution shares: 1 = perfectly even, 0 = one person. */
function participationBalance(amounts: number[]): number | null {
  const total = amounts.reduce((sum, value) => sum + value, 0);
  if (total === 0 || amounts.length < 2) return null;
  const entropy = amounts
    .filter((value) => value > 0)
    .reduce((sum, value) => {
      const share = value / total;
      return sum - share * Math.log(share);
    }, 0);
  return Math.round((entropy / Math.log(amounts.length)) * 1000) / 1000;
}

function round(value: number | null, digits = 3): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

const RATING_COLUMNS: Record<SurveyRatingKey, string> = {
  perceivedHelpfulness: "ai_helpful",
  aiHelpedDiscussion: "ai_helped_discussion",
  aiHelpedFocus: "ai_helped_focus",
  aiHelpedInclusion: "ai_helped_include_everyone",
  aiHelpedDisagreement: "ai_helped_resolve_disagreement",
  collaborationRating: "collaborated_well",
  sharedAnswerRating: "answer_was_shared",
  autonomyRating: "felt_in_control",
  aiHelpedThinking: "ai_helped_me_think",
  overRelianceRating: "relied_too_much_on_ai",
  couldAnswerWithoutAi: "could_answer_without_ai",
  satisfactionRating: "satisfied",
};

const FIELD_COLUMNS = {
  ownWordsExplanation: "own_words",
  finalAnswer: "final",
} as const;

function isCurrentField(field: string): field is keyof typeof FIELD_COLUMNS {
  return field in FIELD_COLUMNS;
}

function supportInfo(scaffoldingType: string | null) {
  const option = scaffoldingType
    ? getScaffoldingOption(scaffoldingType as ScaffoldingType)
    : undefined;
  return {
    support_category: option?.category ?? "",
    support_level: option?.supportLevel ?? null,
  };
}

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function rubricTotal(score: typeof schema.rubricScores.$inferSelect): number {
  return RUBRIC_CRITERIA.reduce((sum, criterion) => sum + score[criterion.key], 0);
}

async function loadStudyData() {
  const [sessions, participants, attempts, surveys, edits, messages, proposals, rubric] =
    await Promise.all([
      db.select().from(schema.sessions),
      db.select().from(schema.participants),
      db.select().from(schema.scenarioAttempts),
      db.select().from(schema.surveys),
      db.select().from(schema.editEvents),
      db.select().from(schema.discussionMessages),
      db.select().from(schema.scaffoldProposals),
      db.select().from(schema.rubricScores),
    ]);

  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const participantById = new Map(participants.map((p) => [p.id, p]));
  const anonymousId = (id: string | null) =>
    (id && participantById.get(id)?.anonymousId) || "";
  const attemptKey = (sessionId: string, scenarioOrder: number) =>
    `${sessionId}:${scenarioOrder}`;
  const attemptByKey = new Map(
    attempts.map((a) => [attemptKey(a.sessionId, a.scenarioOrder), a])
  );

  /** Messages sent at or after the AI request count as "after AI". */
  const sentBeforeAi = (message: (typeof messages)[number]) => {
    const requestedAt = attemptByKey.get(
      attemptKey(message.sessionId, message.scenarioOrder)
    )?.scaffoldingRequestedAt;
    return !requestedAt || message.createdAt < requestedAt;
  };

  const transcript = (list: typeof messages) =>
    list.map((m) => `${anonymousId(m.participantId) || "unknown"}: ${m.text}`).join("\n");

  return {
    sessions,
    participants,
    attempts: attempts.sort(
      (a, b) => a.sessionId.localeCompare(b.sessionId) || a.scenarioOrder - b.scenarioOrder
    ),
    surveys,
    edits: edits.filter((e) => isCurrentField(e.field)),
    messages: messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    proposals: proposals.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    rubric,
    sessionById,
    participantById,
    anonymousId,
    sentBeforeAi,
    transcript,
  };
}

export async function buildScenarioExport(): Promise<CsvExport> {
  const data = await loadStudyData();

  const rows = data.attempts.map((attempt) => {
    const session = data.sessionById.get(attempt.sessionId);
    const scenario = getScenarioById(attempt.scenarioId);
    const members = data.participants.filter((p) => p.sessionId === attempt.sessionId);
    const inAttempt = (row: { sessionId: string; scenarioOrder: number }) =>
      row.sessionId === attempt.sessionId && row.scenarioOrder === attempt.scenarioOrder;
    const attemptMessages = data.messages.filter(inAttempt);
    const attemptEdits = data.edits.filter(inAttempt);
    const attemptProposals = data.proposals.filter(inAttempt);
    const agreedProposal = attemptProposals.find((p) => p.status === "agreed");
    const messagesBeforeAi = attemptMessages.filter(data.sentBeforeAi);
    const messagesAfterAi = attemptMessages.filter((m) => !data.sentBeforeAi(m));
    const discussionBeforeAi = data.transcript(messagesBeforeAi);

    const charsByMember = members.map(
      (member) =>
        attemptMessages
          .filter((m) => m.participantId === member.id)
          .reduce((sum, m) => sum + m.text.length, 0) +
        attemptEdits
          .filter((e) => e.participantId === member.id)
          .reduce((sum, e) => sum + e.charsAdded, 0)
    );
    const totalChars = charsByMember.reduce((sum, value) => sum + value, 0);

    const ratings = data.surveys.filter(
      (s) => s.sessionId === attempt.sessionId && s.scenarioId === attempt.scenarioId
    );
    const finalScores = data.rubric
      .filter((r) => r.attemptId === attempt.id && r.answerType === "final")
      .map(rubricTotal);

    return {
      session_code: session?.code ?? "",
      session_id: attempt.sessionId,
      group_size: members.length,
      scenario_id: attempt.scenarioId,
      scenario_order: attempt.scenarioOrder,
      scenario_title: scenario?.title ?? "",
      task_type: scenario?.taskType ?? "",
      help_reason: attempt.helpReason ?? "",
      help_reason_label: getHelpReasonLabel(attempt.helpReason),
      scaffolding_type: attempt.scaffoldingType ?? "",
      ...supportInfo(attempt.scaffoldingType),
      scaffolding_proposed_by: data.anonymousId(attempt.scaffoldingRequestedBy),
      scaffolding_agreed_by: data.anonymousId(attempt.scaffoldingAgreedBy),
      proposals_made: attemptProposals.length,
      proposals_cancelled: attemptProposals.filter((p) => p.status === "cancelled").length,
      seconds_proposal_to_agreement: agreedProposal
        ? secondsBetween(agreedProposal.createdAt, agreedProposal.resolvedAt)
        : null,
      submitted_by: data.anonymousId(attempt.submittedBy),
      discussion_before_ai: discussionBeforeAi,
      discussion_after_ai: data.transcript(messagesAfterAi),
      messages_before_ai: messagesBeforeAi.length,
      messages_after_ai: messagesAfterAi.length,
      ai_response: attempt.aiResponse ?? "",
      own_words_explanation: attempt.ownWordsExplanation,
      final_answer: attempt.finalAnswer,
      final_length: attempt.finalAnswer.length,
      final_overlap_with_ai: attempt.aiResponse
        ? textOverlap(attempt.finalAnswer, attempt.aiResponse)
        : null,
      final_overlap_with_discussion_before_ai: textOverlap(
        attempt.finalAnswer,
        discussionBeforeAi
      ),
      own_words_overlap_with_ai: attempt.aiResponse
        ? textOverlap(attempt.ownWordsExplanation, attempt.aiResponse)
        : null,
      final_rubric_mean: mean(finalScores),
      contributors_count: charsByMember.filter((value) => value > 0).length,
      top_contributor_share:
        totalChars > 0 ? round(Math.max(...charsByMember) / totalChars) : null,
      participation_balance: participationBalance(charsByMember),
      ratings_count: ratings.length,
      time_before_ai_seconds: secondsBetween(
        attempt.discussionStartedAt,
        attempt.scaffoldingRequestedAt
      ),
      time_after_ai_seconds: secondsBetween(attempt.aiResponseAt, attempt.finalAnswerAt),
      ai_model: attempt.aiModel ?? "",
      ai_latency_ms: attempt.aiLatencyMs,
      discussion_started_at: toIsoString(attempt.discussionStartedAt) ?? "",
      scaffolding_requested_at: toIsoString(attempt.scaffoldingRequestedAt) ?? "",
      ai_response_at: toIsoString(attempt.aiResponseAt) ?? "",
      final_answer_at: toIsoString(attempt.finalAnswerAt) ?? "",
    };
  });

  return { columns: SCENARIO_COLUMNS, rows };
}

const SCENARIO_COLUMNS = [
  "session_code", "session_id", "group_size", "scenario_id", "scenario_order",
  "scenario_title", "task_type", "help_reason", "help_reason_label",
  "scaffolding_type", "support_category", "support_level",
  "scaffolding_proposed_by", "scaffolding_agreed_by", "proposals_made",
  "proposals_cancelled", "seconds_proposal_to_agreement", "submitted_by",
  "discussion_before_ai",
  "discussion_after_ai", "messages_before_ai", "messages_after_ai", "ai_response",
  "own_words_explanation", "final_answer", "final_length", "final_overlap_with_ai",
  "final_overlap_with_discussion_before_ai", "own_words_overlap_with_ai",
  "final_rubric_mean", "contributors_count",
  "top_contributor_share", "participation_balance", "ratings_count",
  "time_before_ai_seconds", "time_after_ai_seconds", "ai_model", "ai_latency_ms",
  "discussion_started_at", "scaffolding_requested_at", "ai_response_at",
  "final_answer_at",
];

export async function buildRatingsExport(): Promise<CsvExport> {
  const data = await loadStudyData();
  const attemptFor = (sessionId: string, scenarioId: string) =>
    data.attempts.find((a) => a.sessionId === sessionId && a.scenarioId === scenarioId);

  const columns = [
    "session_code",
    "anonymous_id",
    "scenario_id",
    "scenario_order",
    "help_reason",
    "scaffolding_type",
    "support_category",
    "support_level",
    "support_amount",
    ...SURVEY_ITEMS.map((item) => RATING_COLUMNS[item.key]),
    "open_reflection",
    "created_at",
  ];

  const rows = data.surveys.map((survey) => {
    const attempt = attemptFor(survey.sessionId, survey.scenarioId);
    const row: CsvRow = {
      session_code: data.sessionById.get(survey.sessionId)?.code ?? "",
      anonymous_id: data.anonymousId(survey.participantId),
      scenario_id: survey.scenarioId,
      scenario_order: attempt?.scenarioOrder ?? getScenarioById(survey.scenarioId)?.order,
      help_reason: attempt?.helpReason ?? "",
      scaffolding_type: attempt?.scaffoldingType ?? "",
      ...supportInfo(attempt?.scaffoldingType ?? null),
      support_amount: survey.supportAmount ?? "",
      open_reflection: survey.openReflection ?? "",
      created_at: toIsoString(survey.createdAt) ?? "",
    };
    for (const item of SURVEY_ITEMS) row[RATING_COLUMNS[item.key]] = survey[item.key];
    return row;
  });

  return { columns, rows };
}

export async function buildContributionsExport(): Promise<CsvExport> {
  const data = await loadStudyData();
  const columns = [
    "session_code",
    "anonymous_id",
    "scenario_order",
    "scaffolding_type",
    "support_level",
    "messages_before_ai",
    "messages_after_ai",
    "message_chars",
    ...Object.values(FIELD_COLUMNS).map((name) => `${name}_chars_added`),
    "total_chars",
    "share_of_group_chars",
    "proposals_made",
    "proposals_agreed_to",
    "proposals_cancelled",
  ];

  const rows: CsvRow[] = [];
  for (const attempt of data.attempts) {
    const members = data.participants.filter((p) => p.sessionId === attempt.sessionId);
    const inAttempt = (row: { sessionId: string; scenarioOrder: number }) =>
      row.sessionId === attempt.sessionId && row.scenarioOrder === attempt.scenarioOrder;
    const attemptEdits = data.edits.filter(inAttempt);
    const attemptMessages = data.messages.filter(inAttempt);
    const attemptProposals = data.proposals.filter(inAttempt);
    const groupChars =
      attemptEdits.reduce((sum, e) => sum + e.charsAdded, 0) +
      attemptMessages.reduce((sum, m) => sum + m.text.length, 0);

    for (const member of members) {
      const memberEdits = attemptEdits.filter((e) => e.participantId === member.id);
      const memberMessages = attemptMessages.filter((m) => m.participantId === member.id);
      const messageChars = memberMessages.reduce((sum, m) => sum + m.text.length, 0);
      const total =
        messageChars + memberEdits.reduce((sum, e) => sum + e.charsAdded, 0);
      const row: CsvRow = {
        session_code: data.sessionById.get(attempt.sessionId)?.code ?? "",
        anonymous_id: member.anonymousId,
        scenario_order: attempt.scenarioOrder,
        scaffolding_type: attempt.scaffoldingType ?? "",
        support_level: supportInfo(attempt.scaffoldingType).support_level,
        messages_before_ai: memberMessages.filter(data.sentBeforeAi).length,
        messages_after_ai: memberMessages.filter((m) => !data.sentBeforeAi(m)).length,
        message_chars: messageChars,
        total_chars: total,
        share_of_group_chars: groupChars > 0 ? round(total / groupChars) : null,
        proposals_made: attemptProposals.filter((p) => p.proposedBy === member.id).length,
        proposals_agreed_to: attemptProposals.filter(
          (p) => p.status === "agreed" && p.resolvedBy === member.id
        ).length,
        proposals_cancelled: attemptProposals.filter(
          (p) => p.status === "cancelled" && p.resolvedBy === member.id
        ).length,
      };
      for (const [field, name] of Object.entries(FIELD_COLUMNS)) {
        row[`${name}_chars_added`] = memberEdits
          .filter((e) => e.field === field)
          .reduce((sum, e) => sum + e.charsAdded, 0);
      }
      rows.push(row);
    }
  }

  return { columns, rows };
}

export async function buildMessagesExport(): Promise<CsvExport> {
  const data = await loadStudyData();
  return {
    columns: [
      "session_code",
      "anonymous_id",
      "scenario_order",
      "sent_before_ai",
      "text",
      "length",
      "created_at",
    ],
    rows: data.messages.map((message) => ({
      session_code: data.sessionById.get(message.sessionId)?.code ?? "",
      anonymous_id: data.anonymousId(message.participantId),
      scenario_order: message.scenarioOrder,
      sent_before_ai: data.sentBeforeAi(message) ? "yes" : "no",
      text: message.text,
      length: message.text.length,
      created_at: toIsoString(message.createdAt) ?? "",
    })),
  };
}

export async function buildProposalsExport(): Promise<CsvExport> {
  const data = await loadStudyData();
  return {
    columns: [
      "session_code",
      "scenario_order",
      "proposed_by",
      "help_reason",
      "scaffolding_type",
      "support_category",
      "support_level",
      "status",
      "resolved_by",
      "seconds_to_decision",
      "created_at",
      "resolved_at",
    ],
    rows: data.proposals.map((proposal) => ({
      session_code: data.sessionById.get(proposal.sessionId)?.code ?? "",
      scenario_order: proposal.scenarioOrder,
      proposed_by: data.anonymousId(proposal.proposedBy),
      help_reason: proposal.helpReason,
      scaffolding_type: proposal.scaffoldingType,
      ...supportInfo(proposal.scaffoldingType),
      status: proposal.status,
      resolved_by: data.anonymousId(proposal.resolvedBy),
      seconds_to_decision: secondsBetween(proposal.createdAt, proposal.resolvedAt),
      created_at: toIsoString(proposal.createdAt) ?? "",
      resolved_at: toIsoString(proposal.resolvedAt) ?? "",
    })),
  };
}

export async function buildEditsExport(): Promise<CsvExport> {
  const data = await loadStudyData();
  const rows = data.edits
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((edit) => ({
      session_code: data.sessionById.get(edit.sessionId)?.code ?? "",
      anonymous_id: data.anonymousId(edit.participantId),
      scenario_order: edit.scenarioOrder,
      field: isCurrentField(edit.field) ? FIELD_COLUMNS[edit.field] : edit.field,
      chars_added: edit.charsAdded,
      chars_removed: edit.charsRemoved,
      inserted_text: edit.insertedText,
      created_at: toIsoString(edit.createdAt) ?? "",
    }));

  return {
    columns: [
      "session_code",
      "anonymous_id",
      "scenario_order",
      "field",
      "chars_added",
      "chars_removed",
      "inserted_text",
      "created_at",
    ],
    rows,
  };
}

export async function buildReflectionsExport(): Promise<CsvExport> {
  const [reflections, data] = await Promise.all([
    db.select().from(schema.finalReflections),
    loadStudyData(),
  ]);
  const rows = reflections.map((reflection) => {
    const row: CsvRow = {
      session_code: data.sessionById.get(reflection.sessionId)?.code ?? "",
      anonymous_id: data.anonymousId(reflection.participantId),
      created_at: toIsoString(reflection.createdAt) ?? "",
    };
    for (const question of FINAL_REFLECTION_QUESTIONS) {
      row[question.id] = reflection.answers?.[question.id] ?? "";
    }
    return row;
  });

  return {
    columns: [
      "session_code",
      "anonymous_id",
      ...FINAL_REFLECTION_QUESTIONS.map((q) => q.id),
      "created_at",
    ],
    rows,
  };
}

export async function buildRubricExport(): Promise<CsvExport> {
  const data = await loadStudyData();
  const attemptById = new Map(data.attempts.map((a) => [a.id, a]));
  const rows = data.rubric.map((score) => {
    const attempt = attemptById.get(score.attemptId);
    const row: CsvRow = {
      session_code: attempt ? data.sessionById.get(attempt.sessionId)?.code ?? "" : "",
      scenario_order: attempt?.scenarioOrder,
      scaffolding_type: attempt?.scaffoldingType ?? "",
      support_level: supportInfo(attempt?.scaffoldingType ?? null).support_level,
      answer_type: score.answerType,
      rater: score.rater,
      total: rubricTotal(score),
      notes: score.notes ?? "",
      updated_at: toIsoString(score.updatedAt) ?? "",
    };
    for (const criterion of RUBRIC_CRITERIA) {
      row[snakeCase(criterion.key)] = score[criterion.key];
    }
    return row;
  });

  return {
    columns: [
      "session_code",
      "scenario_order",
      "scaffolding_type",
      "support_level",
      "answer_type",
      "rater",
      ...RUBRIC_CRITERIA.map((c) => snakeCase(c.key)),
      "total",
      "notes",
      "updated_at",
    ],
    rows,
  };
}

export async function buildAssessmentExport(): Promise<CsvExport> {
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

  const concepts = [...new Set(getAssessment("pre").questions.map((q) => q.concept))];

  return {
    columns: [
      "session_code",
      "anonymous_id",
      "assessment_type",
      "score",
      "max_score",
      ...concepts.map((concept) => `correct_${concept}`),
      "completed_at",
    ],
    rows: rows.map(({ assessment, session, participant }) => {
      const type = assessment.assessmentType === "post" ? "post" : "pre";
      const answers = assessment.answers ?? {};
      const row: CsvRow = {
        session_code: session.code,
        anonymous_id: participant?.anonymousId ?? "",
        assessment_type: assessment.assessmentType,
        score: assessment.score,
        max_score: assessment.maxScore,
        completed_at: toIsoString(assessment.completedAt) ?? "",
      };
      for (const question of getAssessment(type).questions) {
        row[`correct_${question.concept}`] = answers[question.id] === question.correctIndex ? 1 : 0;
      }
      return row;
    }),
  };
}

export const EXPORT_BUILDERS = {
  scenarios: buildScenarioExport,
  ratings: buildRatingsExport,
  contributions: buildContributionsExport,
  messages: buildMessagesExport,
  proposals: buildProposalsExport,
  edits: buildEditsExport,
  reflections: buildReflectionsExport,
  rubric: buildRubricExport,
  assessments: buildAssessmentExport,
} as const;

export type ExportType = keyof typeof EXPORT_BUILDERS;

export function isExportType(value: string): value is ExportType {
  return value in EXPORT_BUILDERS;
}
