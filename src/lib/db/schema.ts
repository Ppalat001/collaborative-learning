import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AuthorRun } from "@/lib/types";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: text("code").notNull().unique(),
  currentScenarioIndex: integer("current_scenario_index").notNull().default(0),
  maxParticipants: integer("max_participants").notNull().default(4),
  consentGiven: integer("consent_given", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  completedAt: text("completed_at"),
});

export const participants = sqliteTable("participants", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  anonymousId: text("anonymous_id").notNull(),
  joinedAt: text("joined_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const scenarioAttempts = sqliteTable("scenario_attempts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  scenarioId: text("scenario_id").notNull(),
  scenarioOrder: integer("scenario_order").notNull(),
  /**
   * No longer collected: AI support is now individual (individualScaffolds). These
   * columns are kept so existing databases don't need a destructive migration.
   */
  discussionText: text("discussion_text").notNull().default(""),
  draftAnswer: text("draft_answer").notNull().default(""),
  helpReason: text("help_reason"),
  scaffoldingType: text("scaffolding_type"),
  scaffoldingRequestedBy: text("scaffolding_requested_by").references(
    () => participants.id,
    { onDelete: "set null" }
  ),
  scaffoldingAgreedBy: text("scaffolding_agreed_by").references(
    () => participants.id,
    { onDelete: "set null" }
  ),
  aiResponse: text("ai_response"),
  aiPromptSystem: text("ai_prompt_system"),
  aiPromptUser: text("ai_prompt_user"),
  aiModel: text("ai_model"),
  aiLatencyMs: integer("ai_latency_ms"),
  /** No longer collected; kept so existing databases don't need a destructive migration. */
  ownWordsExplanation: text("own_words_explanation").notNull().default(""),
  finalAnswer: text("final_answer").notNull().default(""),
  /** Who typed each part of finalAnswer, as consecutive runs whose lengths sum to its length. */
  finalAnswerAuthorship: text("final_answer_authorship", { mode: "json" }).$type<AuthorRun[]>(),
  /** Members who clicked "I am good"; the answer is submitted once every member is in this list. */
  readyParticipantIds: text("ready_participant_ids", { mode: "json" }).$type<string[]>(),
  submittedBy: text("submitted_by").references(() => participants.id, {
    onDelete: "set null",
  }),
  discussionStartedAt: text("discussion_started_at"),
  scaffoldingRequestedAt: text("scaffolding_requested_at"),
  aiResponseAt: text("ai_response_at"),
  finalAnswerAt: text("final_answer_at"),
  submitted: integer("submitted", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const researchEvents = sqliteTable("research_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  participantId: text("participant_id").references(() => participants.id, {
    onDelete: "set null",
  }),
  eventType: text("event_type").notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

/** One row per participant per scenario. AI-specific items are null when no AI was used. */
export const surveys = sqliteTable("surveys", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  participantId: text("participant_id").references(() => participants.id, {
    onDelete: "set null",
  }),
  scenarioId: text("scenario_id").notNull(),
  perceivedHelpfulness: integer("perceived_helpfulness"),
  supportAmount: text("support_amount"),
  aiHelpedDiscussion: integer("ai_helped_discussion"),
  aiHelpedFocus: integer("ai_helped_focus"),
  aiHelpedInclusion: integer("ai_helped_inclusion"),
  aiHelpedDisagreement: integer("ai_helped_disagreement"),
  collaborationRating: integer("collaboration_rating"),
  sharedAnswerRating: integer("shared_answer_rating"),
  autonomyRating: integer("autonomy_rating"),
  aiHelpedThinking: integer("ai_helped_thinking"),
  overRelianceRating: integer("over_reliance_rating"),
  couldAnswerWithoutAi: integer("could_answer_without_ai"),
  satisfactionRating: integer("satisfaction_rating"),
  openReflection: text("open_reflection"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const discussionMessages = sqliteTable("discussion_messages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  participantId: text("participant_id").references(() => participants.id, {
    onDelete: "set null",
  }),
  scenarioOrder: integer("scenario_order").notNull(),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

/**
 * One AI response per participant, scenario and support type. It is generated the
 * first time the participant selects that type and reused on every later selection.
 */
export const individualScaffolds = sqliteTable(
  "individual_scaffolds",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    scenarioOrder: integer("scenario_order").notNull(),
    scaffoldingType: text("scaffolding_type").notNull(),
    aiResponse: text("ai_response").notNull(),
    aiPromptSystem: text("ai_prompt_system"),
    aiPromptUser: text("ai_prompt_user"),
    aiModel: text("ai_model"),
    aiLatencyMs: integer("ai_latency_ms"),
    selected: integer("selected", { mode: "boolean" }).notNull().default(true),
    timesSelected: integer("times_selected").notNull().default(1),
    timesUnselected: integer("times_unselected").notNull().default(0),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    lastToggledAt: text("last_toggled_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("individual_scaffolds_unique").on(
      table.participantId,
      table.scenarioOrder,
      table.scaffoldingType
    ),
  ]
);

/** No longer collected (group proposals were replaced by individual AI support). */
export const scaffoldProposals = sqliteTable("scaffold_proposals", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  scenarioOrder: integer("scenario_order").notNull(),
  proposedBy: text("proposed_by").references(() => participants.id, {
    onDelete: "set null",
  }),
  helpReason: text("help_reason").notNull(),
  scaffoldingType: text("scaffolding_type").notNull(),
  /** "pending" | "agreed" | "cancelled" */
  status: text("status").notNull().default("pending"),
  resolvedBy: text("resolved_by").references(() => participants.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  resolvedAt: text("resolved_at"),
});

/** Each batch of typing by one participant in one shared box. */
export const editEvents = sqliteTable("edit_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  participantId: text("participant_id").references(() => participants.id, {
    onDelete: "set null",
  }),
  scenarioOrder: integer("scenario_order").notNull(),
  field: text("field").notNull(),
  charsAdded: integer("chars_added").notNull(),
  charsRemoved: integer("chars_removed").notNull(),
  insertedText: text("inserted_text").notNull().default(""),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const finalReflections = sqliteTable("final_reflections", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  participantId: text("participant_id").references(() => participants.id, {
    onDelete: "set null",
  }),
  answers: text("answers", { mode: "json" }).$type<Record<string, string>>(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

/** Researcher-scored quality of a group's final answer. */
export const rubricScores = sqliteTable("rubric_scores", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  attemptId: text("attempt_id")
    .notNull()
    .references(() => scenarioAttempts.id, { onDelete: "cascade" }),
  answerType: text("answer_type").notNull(),
  rater: text("rater").notNull(),
  correctness: integer("correctness").notNull(),
  clarity: integer("clarity").notNull(),
  reasoning: integer("reasoning").notNull(),
  completeness: integer("completeness").notNull(),
  useOfExamples: integer("use_of_examples").notNull(),
  depth: integer("depth").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const assessments = sqliteTable("assessments", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  participantId: text("participant_id").references(() => participants.id, {
    onDelete: "set null",
  }),
  assessmentType: text("assessment_type").notNull(),
  answers: text("answers", { mode: "json" }).$type<Record<string, number>>(),
  openAnswers: text("open_answers", { mode: "json" }).$type<Record<string, string>>(),
  score: integer("score").notNull(),
  maxScore: integer("max_score").notNull(),
  completedAt: text("completed_at").notNull().$defaultFn(() => new Date().toISOString()),
});
