import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { charsByAuthor } from "@/lib/authorship";
import {
  FINAL_REFLECTION_QUESTIONS,
  RUBRIC_CRITERIA,
  SUPPORT_AMOUNTS,
  SURVEY_ITEMS,
  countWords,
  type SurveyRatingKey,
} from "@/lib/instruments";
import {
  SUPPORT_LEVEL_LABELS,
  getScaffoldingOption,
  type ScaffoldingType,
  type SupportLevel,
} from "@/lib/types";
import { secondsBetween } from "@/lib/utils/dates";
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
  return shared / textGrams.size;
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
  return round(entropy / Math.log(amounts.length), 2);
}

function round(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function minutesBetween(start: string | null, end: string | null): number | null {
  const seconds = secondsBetween(start, end);
  return seconds === null ? null : round(seconds / 60, 1);
}

/** "2026-10-19 14:35:02" in UTC. */
function readableTime(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 19).replace("T", " ") : "";
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

const RATING_COLUMNS: Record<SurveyRatingKey, string> = {
  perceivedHelpfulness: "ai_helpful",
  aiHelpedDiscussion: "ai_helped_my_contribution",
  aiHelpedFocus: "ai_helped_focus",
  aiHelpedInclusion: "ai_helped_include_others",
  aiHelpedDisagreement: "ai_helped_resolve_disagreement",
  collaborationRating: "collaborated_well",
  sharedAnswerRating: "answer_was_shared",
  autonomyRating: "felt_in_control",
  aiHelpedThinking: "ai_helped_me_think",
  overRelianceRating: "relied_too_much_on_ai",
  couldAnswerWithoutAi: "could_contribute_without_ai",
  satisfactionRating: "satisfied",
};

function supportLabel(type: string): string {
  return getScaffoldingOption(type as ScaffoldingType)?.label ?? type;
}

function levelText(level: number): string {
  return `${level} - ${SUPPORT_LEVEL_LABELS[level as SupportLevel] ?? ""}`;
}

/** "Level 2 - Moderate" for answer help, "Collaboration support" for process help. */
function supportKind(type: string): string {
  const option = getScaffoldingOption(type as ScaffoldingType);
  if (!option) return "";
  if (option.category === "process") return "Collaboration support";
  return option.supportLevel === null ? "" : `Level ${levelText(option.supportLevel)}`;
}

type ScaffoldRow = typeof schema.individualScaffolds.$inferSelect;

function highestLevel(scaffolds: ScaffoldRow[]): string {
  if (scaffolds.length === 0) return "none";
  const levels = scaffolds.flatMap((s) => {
    const level = getScaffoldingOption(s.scaffoldingType as ScaffoldingType)?.supportLevel;
    return level === null || level === undefined ? [] : [level];
  });
  return levels.length > 0 ? levelText(Math.max(...levels)) : "collaboration support only";
}

function helpList(scaffolds: ScaffoldRow[]): string {
  return [...new Set(scaffolds.map((s) => supportLabel(s.scaffoldingType)))].join(", ");
}

function rubricTotal(score: typeof schema.rubricScores.$inferSelect): number {
  return RUBRIC_CRITERIA.reduce((sum, criterion) => sum + score[criterion.key], 0);
}

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Everything recorded for one group (session), ready to turn into CSV rows. */
async function loadGroupData(sessionId: string) {
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));
  const [participants, attempts, surveys, edits, messages, scaffolds, reflections, tests] =
    await Promise.all([
      db.select().from(schema.participants).where(eq(schema.participants.sessionId, sessionId)),
      db
        .select()
        .from(schema.scenarioAttempts)
        .where(eq(schema.scenarioAttempts.sessionId, sessionId)),
      db.select().from(schema.surveys).where(eq(schema.surveys.sessionId, sessionId)),
      db.select().from(schema.editEvents).where(eq(schema.editEvents.sessionId, sessionId)),
      db
        .select()
        .from(schema.discussionMessages)
        .where(eq(schema.discussionMessages.sessionId, sessionId)),
      db
        .select()
        .from(schema.individualScaffolds)
        .where(eq(schema.individualScaffolds.sessionId, sessionId)),
      db
        .select()
        .from(schema.finalReflections)
        .where(eq(schema.finalReflections.sessionId, sessionId)),
      db.select().from(schema.assessments).where(eq(schema.assessments.sessionId, sessionId)),
    ]);

  const attemptIds = new Set(attempts.map((a) => a.id));
  const rubric = (await db.select().from(schema.rubricScores)).filter((r) =>
    attemptIds.has(r.attemptId)
  );

  const members = participants.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const participantById = new Map(members.map((p) => [p.id, p]));
  const nameOf = (id: string | null) =>
    (id && participantById.get(id)?.displayName) || "unknown";
  const studentIdOf = (id: string | null) => (id && participantById.get(id)?.anonymousId) || "";

  const sortedScaffolds = scaffolds.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const firstAiAt = new Map<number, string>();
  for (const scaffold of sortedScaffolds) {
    if (!firstAiAt.has(scaffold.scenarioOrder)) {
      firstAiAt.set(scaffold.scenarioOrder, scaffold.createdAt);
    }
  }

  /** Messages sent before any member of the group first asked the AI count as "before AI". */
  const sentBeforeAi = (message: (typeof messages)[number]) => {
    const requestedAt = firstAiAt.get(message.scenarioOrder);
    return !requestedAt || message.createdAt < requestedAt;
  };

  return {
    code: session?.code ?? "",
    members,
    attempts: attempts.sort((a, b) => a.scenarioOrder - b.scenarioOrder),
    surveys,
    edits: edits.filter((e) => e.field === "finalAnswer"),
    messages: messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    scaffolds: sortedScaffolds,
    reflections,
    tests,
    rubric,
    nameOf,
    studentIdOf,
    firstAiAt,
    sentBeforeAi,
  };
}

type GroupData = Awaited<ReturnType<typeof loadGroupData>>;

function buildGroupAnswersExport(data: GroupData): CsvExport {
  const columns = [
    "group",
    "scenario_number",
    "scenario_title",
    "group_members",
    "finished",
    "final_answer",
    "answer_words",
    "answer_written_by",
    "ai_help_used_by_each_student",
    "highest_ai_level_used",
    "students_who_saw_full_answer",
    "answer_copied_from_ai_percent",
    "answer_matches_chat_before_ai_percent",
    "chat_messages_before_ai",
    "chat_messages_after_ai",
    "participation_balance_0_to_1",
    "minutes_before_first_ai",
    "minutes_total",
    "rubric_total_6_to_24",
    "finished_at_utc",
  ];

  const rows = data.attempts.map((attempt) => {
    const order = attempt.scenarioOrder;
    const messages = data.messages.filter((m) => m.scenarioOrder === order);
    const edits = data.edits.filter((e) => e.scenarioOrder === order);
    const scaffolds = data.scaffolds.filter((s) => s.scenarioOrder === order);
    const before = messages.filter(data.sentBeforeAi);
    const chatBeforeAi = before.map((m) => m.text).join("\n");
    const aiText = scaffolds.map((s) => s.aiResponse).join("\n");

    const authored = charsByAuthor(attempt.finalAnswerAuthorship);
    const authoredTotal = [...authored.values()].reduce((sum, value) => sum + value, 0);
    const writtenBy = data.members
      .map((m) => ({ name: m.displayName, chars: authored.get(m.id) ?? 0 }))
      .filter((m) => m.chars > 0)
      .map((m) => `${m.name} ${Math.round((m.chars / authoredTotal) * 100)}%`)
      .join(", ");

    const activity = data.members.map(
      (member) =>
        messages
          .filter((m) => m.participantId === member.id)
          .reduce((sum, m) => sum + m.text.length, 0) +
        edits
          .filter((e) => e.participantId === member.id)
          .reduce((sum, e) => sum + e.charsAdded, 0)
    );

    const helpByStudent = data.members
      .map((member) => {
        const own = scaffolds.filter((s) => s.participantId === member.id);
        return `${member.displayName}: ${own.length > 0 ? helpList(own) : "none"}`;
      })
      .join(" | ");

    const sawFullAnswer = [
      ...new Set(
        scaffolds
          .filter((s) => s.scaffoldingType === "full_answer")
          .map((s) => data.nameOf(s.participantId))
      ),
    ].join(", ");

    const started = attempt.discussionStartedAt ?? attempt.createdAt;
    const totals = data.rubric
      .filter((r) => r.attemptId === attempt.id && r.answerType === "final")
      .map(rubricTotal);

    return {
      group: data.code,
      scenario_number: order,
      scenario_title: getScenarioById(attempt.scenarioId)?.title ?? "",
      group_members: data.members.map((m) => m.displayName).join(", "),
      finished: yesNo(attempt.submitted),
      final_answer: attempt.finalAnswer,
      answer_words: countWords(attempt.finalAnswer),
      answer_written_by: writtenBy,
      ai_help_used_by_each_student: helpByStudent,
      highest_ai_level_used: highestLevel(scaffolds),
      students_who_saw_full_answer: sawFullAnswer,
      answer_copied_from_ai_percent: aiText
        ? percent(textOverlap(attempt.finalAnswer, aiText))
        : null,
      answer_matches_chat_before_ai_percent: percent(
        textOverlap(attempt.finalAnswer, chatBeforeAi)
      ),
      chat_messages_before_ai: before.length,
      chat_messages_after_ai: messages.length - before.length,
      participation_balance_0_to_1: participationBalance(activity),
      minutes_before_first_ai: minutesBetween(started, data.firstAiAt.get(order) ?? null),
      minutes_total: minutesBetween(started, attempt.finalAnswerAt),
      rubric_total_6_to_24: mean(totals),
      finished_at_utc: readableTime(attempt.finalAnswerAt),
    };
  });

  return { columns, rows };
}

function buildMessagesExport(data: GroupData): CsvExport {
  return {
    columns: ["group", "scenario_number", "time_utc", "student", "message", "before_or_after_ai"],
    rows: data.messages.map((message) => ({
      group: data.code,
      scenario_number: message.scenarioOrder,
      time_utc: readableTime(message.createdAt),
      student: data.nameOf(message.participantId),
      message: message.text,
      before_or_after_ai: data.sentBeforeAi(message) ? "before AI" : "after AI",
    })),
  };
}

function buildAiSupportExport(data: GroupData): CsvExport {
  return {
    columns: [
      "group",
      "scenario_number",
      "student",
      "student_id",
      "ai_help_selected",
      "help_level",
      "still_shown_at_end",
      "times_shown",
      "times_hidden",
      "group_chat_messages_before_request",
      "answer_copied_from_this_help_percent",
      "real_ai_response",
      "ai_response",
      "requested_at_utc",
    ],
    rows: data.scaffolds.map((scaffold) => {
      const attempt = data.attempts.find((a) => a.scenarioOrder === scaffold.scenarioOrder);
      return {
        group: data.code,
        scenario_number: scaffold.scenarioOrder,
        student: data.nameOf(scaffold.participantId),
        student_id: data.studentIdOf(scaffold.participantId),
        ai_help_selected: supportLabel(scaffold.scaffoldingType),
        help_level: supportKind(scaffold.scaffoldingType),
        still_shown_at_end: yesNo(scaffold.selected),
        times_shown: scaffold.timesSelected,
        times_hidden: scaffold.timesUnselected,
        group_chat_messages_before_request: data.messages.filter(
          (m) => m.scenarioOrder === scaffold.scenarioOrder && m.createdAt < scaffold.createdAt
        ).length,
        answer_copied_from_this_help_percent: attempt
          ? percent(textOverlap(attempt.finalAnswer, scaffold.aiResponse))
          : null,
        real_ai_response: yesNo(scaffold.aiModel !== "mock"),
        ai_response: scaffold.aiResponse,
        requested_at_utc: readableTime(scaffold.createdAt),
      };
    }),
  };
}

function buildContributionsExport(data: GroupData): CsvExport {
  const columns = [
    "group",
    "scenario_number",
    "student",
    "student_id",
    "chat_messages",
    "chat_messages_before_ai",
    "chat_messages_after_ai",
    "chat_words",
    "characters_typed_in_answer",
    "share_of_final_answer_percent",
    "share_of_group_activity_percent",
    "ai_help_used",
    "clicked_i_am_good",
  ];

  const rows: CsvRow[] = [];
  for (const attempt of data.attempts) {
    const order = attempt.scenarioOrder;
    const messages = data.messages.filter((m) => m.scenarioOrder === order);
    const edits = data.edits.filter((e) => e.scenarioOrder === order);
    const authored = charsByAuthor(attempt.finalAnswerAuthorship);
    const groupActivity =
      edits.reduce((sum, e) => sum + e.charsAdded, 0) +
      messages.reduce((sum, m) => sum + m.text.length, 0);
    const readyIds = new Set(attempt.readyParticipantIds ?? []);

    for (const member of data.members) {
      const own = messages.filter((m) => m.participantId === member.id);
      const typed = edits
        .filter((e) => e.participantId === member.id)
        .reduce((sum, e) => sum + e.charsAdded, 0);
      const activity = typed + own.reduce((sum, m) => sum + m.text.length, 0);
      const scaffolds = data.scaffolds.filter(
        (s) => s.scenarioOrder === order && s.participantId === member.id
      );
      rows.push({
        group: data.code,
        scenario_number: order,
        student: member.displayName,
        student_id: member.anonymousId,
        chat_messages: own.length,
        chat_messages_before_ai: own.filter(data.sentBeforeAi).length,
        chat_messages_after_ai: own.filter((m) => !data.sentBeforeAi(m)).length,
        chat_words: own.reduce((sum, m) => sum + countWords(m.text), 0),
        characters_typed_in_answer: typed,
        share_of_final_answer_percent:
          attempt.finalAnswer.length > 0
            ? percent((authored.get(member.id) ?? 0) / attempt.finalAnswer.length)
            : null,
        share_of_group_activity_percent:
          groupActivity > 0 ? percent(activity / groupActivity) : null,
        ai_help_used: scaffolds.length > 0 ? helpList(scaffolds) : "none",
        clicked_i_am_good: yesNo(readyIds.has(member.id)),
      });
    }
  }

  return { columns, rows };
}

function buildRatingsExport(data: GroupData): CsvExport {
  const columns = [
    "group",
    "scenario_number",
    "scenario_title",
    "student",
    "student_id",
    "used_ai",
    "ai_help_used",
    "amount_of_ai_help",
    ...SURVEY_ITEMS.map((item) => RATING_COLUMNS[item.key]),
    "comment",
  ];

  const rows = data.surveys
    .map((survey) => {
      const scenario = getScenarioById(survey.scenarioId);
      const order = scenario?.order ?? 0;
      const scaffolds = data.scaffolds.filter(
        (s) => s.scenarioOrder === order && s.participantId === survey.participantId
      );
      const row: CsvRow = {
        group: data.code,
        scenario_number: order,
        scenario_title: scenario?.title ?? "",
        student: data.nameOf(survey.participantId),
        student_id: data.studentIdOf(survey.participantId),
        used_ai: yesNo(scaffolds.length > 0),
        ai_help_used: scaffolds.length > 0 ? helpList(scaffolds) : "none",
        amount_of_ai_help:
          SUPPORT_AMOUNTS.find((a) => a.id === survey.supportAmount)?.label ?? "",
        comment: survey.openReflection ?? "",
      };
      for (const item of SURVEY_ITEMS) row[RATING_COLUMNS[item.key]] = survey[item.key];
      return row;
    })
    .sort(
      (a, b) =>
        Number(a.scenario_number) - Number(b.scenario_number) ||
        String(a.student).localeCompare(String(b.student))
    );

  return { columns, rows };
}

/** One row per student: pre and post side by side so they can be compared directly. */
function buildTestsExport(data: GroupData): CsvExport {
  const pre = getAssessment("pre");
  const post = getAssessment("post");
  const concepts = [...new Set(pre.questions.map((q) => q.concept))];
  const openIds = pre.openQuestions.map((q) => q.id);

  const columns = [
    "group",
    "student",
    "student_id",
    "pre_score",
    "post_score",
    "max_score",
    "score_change",
    ...concepts.flatMap((c) => [`pre_${c}`, `post_${c}`]),
    ...openIds.flatMap((id) => [`pre_${id}`, `post_${id}`]),
    "pre_completed_at_utc",
    "post_completed_at_utc",
  ];

  const rows = data.members.map((member) => {
    const find = (type: "pre" | "post") =>
      data.tests.find((t) => t.participantId === member.id && t.assessmentType === type);
    const preTest = find("pre");
    const postTest = find("post");
    const row: CsvRow = {
      group: data.code,
      student: member.displayName,
      student_id: member.anonymousId,
      pre_score: preTest?.score ?? null,
      post_score: postTest?.score ?? null,
      max_score: pre.questions.length,
      score_change: preTest && postTest ? postTest.score - preTest.score : null,
      pre_completed_at_utc: readableTime(preTest?.completedAt),
      post_completed_at_utc: readableTime(postTest?.completedAt),
    };

    for (const [prefix, test, assessment] of [
      ["pre", preTest, pre],
      ["post", postTest, post],
    ] as const) {
      if (!test) continue;
      const answers = test.answers ?? {};
      for (const question of assessment.questions) {
        row[`${prefix}_${question.concept}`] =
          answers[question.id] === question.correctIndex ? 1 : 0;
      }
      for (const id of openIds) row[`${prefix}_${id}`] = test.openAnswers?.[id] ?? "";
    }
    return row;
  });

  return { columns, rows };
}

function buildQuestionnaireExport(data: GroupData): CsvExport {
  const rows = data.reflections.map((reflection) => {
    const row: CsvRow = {
      group: data.code,
      student: data.nameOf(reflection.participantId),
      student_id: data.studentIdOf(reflection.participantId),
      submitted_at_utc: readableTime(reflection.createdAt),
    };
    for (const question of FINAL_REFLECTION_QUESTIONS) {
      row[question.id] = reflection.answers?.[question.id] ?? "";
    }
    return row;
  });

  return {
    columns: [
      "group",
      "student",
      "student_id",
      ...FINAL_REFLECTION_QUESTIONS.map((q) => q.id),
      "submitted_at_utc",
    ],
    rows,
  };
}

function buildRubricExport(data: GroupData): CsvExport {
  const attemptById = new Map(data.attempts.map((a) => [a.id, a]));
  const rows = data.rubric
    .map((score) => {
      const attempt = attemptById.get(score.attemptId);
      const order = attempt?.scenarioOrder ?? 0;
      const scaffolds = data.scaffolds.filter((s) => s.scenarioOrder === order);
      const total = rubricTotal(score);
      const row: CsvRow = {
        group: data.code,
        scenario_number: order,
        scenario_title: attempt ? getScenarioById(attempt.scenarioId)?.title ?? "" : "",
        rater: score.rater,
        total_6_to_24: total,
        average_1_to_4: round(total / RUBRIC_CRITERIA.length),
        ai_help_used_in_group: scaffolds.length > 0 ? helpList(scaffolds) : "none",
        highest_ai_level_used: highestLevel(scaffolds),
        notes: score.notes ?? "",
      };
      for (const criterion of RUBRIC_CRITERIA) {
        row[snakeCase(criterion.key)] = score[criterion.key];
      }
      return row;
    })
    .sort((a, b) => Number(a.scenario_number) - Number(b.scenario_number));

  return {
    columns: [
      "group",
      "scenario_number",
      "scenario_title",
      "rater",
      ...RUBRIC_CRITERIA.map((c) => snakeCase(c.key)),
      "total_6_to_24",
      "average_1_to_4",
      "ai_help_used_in_group",
      "highest_ai_level_used",
      "notes",
    ],
    rows,
  };
}

export const EXPORT_BUILDERS = {
  scenarios: buildGroupAnswersExport,
  messages: buildMessagesExport,
  ai_support: buildAiSupportExport,
  contributions: buildContributionsExport,
  ratings: buildRatingsExport,
  assessments: buildTestsExport,
  reflections: buildQuestionnaireExport,
  rubric: buildRubricExport,
} as const;

export type ExportType = keyof typeof EXPORT_BUILDERS;

export function isExportType(value: string): value is ExportType {
  return value in EXPORT_BUILDERS;
}

export async function buildGroupExport(type: ExportType, sessionId: string) {
  return EXPORT_BUILDERS[type](await loadGroupData(sessionId));
}
