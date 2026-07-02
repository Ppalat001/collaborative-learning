import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

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
  discussionText: text("discussion_text").notNull().default(""),
  draftAnswer: text("draft_answer").notNull().default(""),
  scaffoldingType: text("scaffolding_type"),
  aiResponse: text("ai_response"),
  aiPromptSystem: text("ai_prompt_system"),
  aiPromptUser: text("ai_prompt_user"),
  aiModel: text("ai_model"),
  aiLatencyMs: integer("ai_latency_ms"),
  finalAnswer: text("final_answer").notNull().default(""),
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

export const surveys = sqliteTable("surveys", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  scenarioId: text("scenario_id").notNull(),
  autonomyRating: integer("autonomy_rating"),
  satisfactionRating: integer("satisfaction_rating"),
  collaborationRating: integer("collaboration_rating"),
  perceivedHelpfulness: integer("perceived_helpfulness"),
  openReflection: text("open_reflection"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
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
  score: integer("score").notNull(),
  maxScore: integer("max_score").notNull(),
  completedAt: text("completed_at").notNull().$defaultFn(() => new Date().toISOString()),
});
