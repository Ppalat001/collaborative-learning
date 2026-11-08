import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AuthorRun } from "@/lib/types";
import type { LearnerState } from "@/lib/intervention/adaptive/LearnerModel";
import type { StudyFeatures } from "@/lib/intervention/types";

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
  /** SHA-256 of the participant's device token; null for members who joined before tokens existed. */
  authTokenHash: text("auth_token_hash"),
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
  /** Metacognitive popup: confidence in the group answer (1-5), why, and what to do differently. */
  answerConfidence: integer("answer_confidence"),
  confidenceReason: text("confidence_reason"),
  doDifferently: text("do_differently"),
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

// ---------------------------------------------------------------------------
// Adaptive Scaffolding V2. Additive only: a group is a V2 group exactly when it
// has a study_assignments row, written once at creation. Groups without one keep
// the original behavior and are exported as "legacy".
// ---------------------------------------------------------------------------

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  text("created_at").notNull().$defaultFn(() => new Date().toISOString());
const sessionRef = () =>
  text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" });

/**
 * Condition and every instrument/policy/model version for a V2 group.
 * Immutable after insert except the one-way roster freeze (enforced by a trigger
 * created in src/lib/db/index.ts).
 */
export const studyAssignments = sqliteTable(
  "study_assignments",
  {
    id: id(),
    sessionId: sessionRef(),
    researchCondition: text("research_condition").notNull(),
    /** researcher_selected | configured_default | randomized */
    assignmentMethod: text("assignment_method").notNull(),
    /** admin | home_page */
    createdVia: text("created_via").notNull(),
    studyProtocolVersion: text("study_protocol_version").notNull(),
    consentVersion: text("consent_version").notNull(),
    informationSheetVersion: text("information_sheet_version").notNull(),
    scenarioSetVersion: text("scenario_set_version").notNull(),
    assessmentVersion: text("assessment_version").notNull(),
    interventionPolicyVersion: text("intervention_policy_version").notNull(),
    modelConfigVersion: text("model_config_version").notNull(),
    /** real | mock, at the time the group was created. */
    aiModeAtAssignment: text("ai_mode_at_assignment").notNull(),
    minGroupSize: integer("min_group_size").notNull(),
    maxGroupSize: integer("max_group_size").notNull(),
    features: text("features", { mode: "json" }).$type<StudyFeatures>().notNull(),
    assignedAt: text("assigned_at").notNull().$defaultFn(() => new Date().toISOString()),
    rosterFrozenAt: text("roster_frozen_at"),
    frozenRosterIds: text("frozen_roster_ids", { mode: "json" }).$type<string[]>(),
    startedBy: text("started_by"),
  },
  (table) => [uniqueIndex("study_assignments_session_unique").on(table.sessionId)]
);

/** One consent record per participant (V2 groups only). Withdrawal is recorded, never deleted. */
export const participantConsents = sqliteTable(
  "participant_consents",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    consentVersion: text("consent_version").notNull(),
    informationSheetVersion: text("information_sheet_version").notNull(),
    /** The checkbox ids the participant ticked, in order. */
    confirmedStatements: text("confirmed_statements", { mode: "json" }).$type<string[]>().notNull(),
    aiProcessingAcknowledged: integer("ai_processing_acknowledged", { mode: "boolean" }).notNull(),
    consentedAt: text("consented_at").notNull().$defaultFn(() => new Date().toISOString()),
    withdrawnAt: text("withdrawn_at"),
    withdrawalNote: text("withdrawal_note"),
    /** Recorded by the researcher when a member leaves a started group for good. */
    droppedOutAt: text("dropped_out_at"),
    dropOutNote: text("drop_out_note"),
  },
  (table) => [uniqueIndex("participant_consents_participant_unique").on(table.participantId)]
);

/** Optional private pre-AI idea per member and scenario (instrument flag `initialIdea`). */
export const scenarioInitialIdeas = sqliteTable(
  "scenario_initial_ideas",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    scenarioOrder: integer("scenario_order").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("scenario_initial_ideas_unique").on(table.participantId, table.scenarioOrder),
  ]
);

/** A human role a member chose to take for one scenario (instrument flag `roles`). */
export const groupRoles = sqliteTable(
  "group_roles",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    scenarioOrder: integer("scenario_order").notNull(),
    role: text("role").notNull(),
    /** Whether the role matches the suggested rotation. */
    matchesRotation: integer("matches_rotation", { mode: "boolean" }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("group_roles_unique").on(table.participantId, table.scenarioOrder)]
);

/** Non-AI checkpoint questions a member raised for the whole group. */
export const groupCheckpoints = sqliteTable(
  "group_checkpoints",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: text("participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),
    scenarioOrder: integer("scenario_order").notNull(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("group_checkpoints_scenario").on(table.sessionId, table.scenarioOrder)]
);

/** Member's short justification when clicking "I am good" (instrument flag `agreementReason`). */
export const scenarioAgreementReasons = sqliteTable(
  "scenario_agreement_reasons",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    scenarioOrder: integer("scenario_order").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("scenario_agreement_reasons_scenario").on(table.sessionId, table.scenarioOrder),
  ]
);

/**
 * Every logged evaluation of a scenario, including the decision NOT to intervene.
 * Unchanged repeated no-action evaluations are collapsed (see intervention_state).
 */
export const interventionEvaluations = sqliteTable(
  "intervention_evaluations",
  {
    id: id(),
    sessionId: sessionRef(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => scenarioAttempts.id, { onDelete: "cascade" }),
    scenarioOrder: integer("scenario_order").notNull(),
    /** human_activity | scheduler | manual_request | personal_request */
    evaluationSource: text("evaluation_source").notNull(),
    researchCondition: text("research_condition").notNull(),
    policyVersion: text("policy_version").notNull(),
    trigger: text("trigger").notNull(),
    assessmentSource: text("assessment_source"),
    evidenceMessageIds: text("evidence_message_ids", { mode: "json" }).$type<string[]>(),
    evidenceSummary: text("evidence_summary"),
    confidence: real("confidence"),
    progressState: text("progress_state"),
    /** All assessments the monitor produced, for audit. */
    assessments: text("assessments", { mode: "json" }).$type<unknown[]>(),
    decisionAction: text("decision_action").notNull(),
    decisionScope: text("decision_scope"),
    targetParticipantId: text("target_participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),
    supportType: text("support_type"),
    recommendedLevel: text("recommended_level"),
    reasonCode: text("reason_code").notNull(),
    reasonExplanation: text("reason_explanation").notNull(),
    /** Count + newest id of human messages and newest edit time at evaluation. */
    activityWatermark: text("activity_watermark").notNull(),
    onlineCount: integer("online_count").notNull(),
    activeMemberCount: integer("active_member_count").notNull(),
    classifierModel: text("classifier_model"),
    /** True when the condition only allows logging (no exposure to students). */
    shadowOnly: integer("shadow_only", { mode: "boolean" }).notNull().default(false),
    repeatCount: integer("repeat_count").notNull().default(1),
    evaluatedAt: text("evaluated_at").notNull().$defaultFn(() => new Date().toISOString()),
    lastRepeatedAt: text("last_repeated_at"),
  },
  (table) => [index("intervention_evaluations_attempt").on(table.attemptId, table.evaluatedAt)]
);

/** Offered or delivered AI facilitation, group-visible or private to one member. */
export const interventions = sqliteTable(
  "interventions",
  {
    id: id(),
    sessionId: sessionRef(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => scenarioAttempts.id, { onDelete: "cascade" }),
    scenarioOrder: integer("scenario_order").notNull(),
    evaluationId: text("evaluation_id").references(() => interventionEvaluations.id, {
      onDelete: "set null",
    }),
    /** group | individual */
    scope: text("scope").notNull(),
    /** Only for scope=individual; private to this member. */
    recipientParticipantId: text("recipient_participant_id").references(() => participants.id, {
      onDelete: "cascade",
    }),
    /** system (proactive) | participant (manual request) */
    initiatedBy: text("initiated_by").notNull(),
    requestedByParticipantId: text("requested_by_participant_id").references(
      () => participants.id,
      { onDelete: "set null" }
    ),
    trigger: text("trigger").notNull(),
    /** process | content */
    category: text("category").notNull(),
    supportType: text("support_type").notNull(),
    /** "1" | "2" | "3" | "process" */
    scaffoldLevel: text("scaffold_level").notNull(),
    status: text("status").notNull(),
    offerText: text("offer_text").notNull(),
    reasonCode: text("reason_code").notNull(),
    reasonExplanation: text("reason_explanation").notNull(),
    content: text("content"),
    researchCondition: text("research_condition").notNull(),
    policyVersion: text("policy_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    aiModel: text("ai_model"),
    /** real | mock | template_fallback (model output rejected by the validator) */
    aiOrigin: text("ai_origin"),
    aiLatencyMs: integer("ai_latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    failureReason: text("failure_reason"),
    acceptedByParticipantId: text("accepted_by_participant_id").references(
      () => participants.id,
      { onDelete: "set null" }
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
    acceptedAt: text("accepted_at"),
    deliveredAt: text("delivered_at"),
    resolvedAt: text("resolved_at"),
    expiresAt: text("expires_at"),
  },
  (table) => [
    uniqueIndex("interventions_idempotency_unique").on(table.idempotencyKey),
    index("interventions_attempt").on(table.attemptId, table.createdAt),
    index("interventions_recipient").on(table.recipientParticipantId),
  ]
);

/** Each member's own response to an intervention (view, accept, dismiss, defer, why, share). */
export const interventionFeedback = sqliteTable(
  "intervention_feedback",
  {
    id: id(),
    sessionId: sessionRef(),
    interventionId: text("intervention_id")
      .notNull()
      .references(() => interventions.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (table) => [index("intervention_feedback_intervention").on(table.interventionId)]
);

/** Orchestrator bookkeeping per scenario attempt (cooldowns, counts, last evaluation). */
export const interventionState = sqliteTable(
  "intervention_state",
  {
    id: id(),
    sessionId: sessionRef(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => scenarioAttempts.id, { onDelete: "cascade" }),
    lastEvaluatedAt: text("last_evaluated_at"),
    lastEvaluationId: text("last_evaluation_id"),
    lastEvaluationSignature: text("last_evaluation_signature"),
    lastProactiveAt: text("last_proactive_at"),
    proactiveGroupCount: integer("proactive_group_count").notNull().default(0),
    proactivePrivateCount: integer("proactive_private_count").notNull().default(0),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("intervention_state_attempt_unique").on(table.attemptId)]
);

/** A member's opt-in to private proactive offers (default off). */
export const participantAiPreferences = sqliteTable(
  "participant_ai_preferences",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    privateOffersOptIn: integer("private_offers_opt_in", { mode: "boolean" }).notNull(),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("participant_ai_preferences_unique").on(table.participantId)]
);

/** Text a member explicitly chose to share from private AI support. Not proof that anyone read it. */
export const aiSharingEvents = sqliteTable(
  "ai_sharing_events",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    scenarioOrder: integer("scenario_order").notNull(),
    /** individual_scaffold | intervention */
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    sourceSupportType: text("source_support_type").notNull(),
    sharedText: text("shared_text").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("ai_sharing_events_scenario").on(table.sessionId, table.scenarioOrder)]
);

/** Adaptive level recommendation, its evidence, and what the member actually chose. */
export const scaffoldRecommendations = sqliteTable(
  "scaffold_recommendations",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    scenarioOrder: integer("scenario_order").notNull(),
    interventionId: text("intervention_id").references(() => interventions.id, {
      onDelete: "set null",
    }),
    engineVersion: text("engine_version").notNull(),
    recommendedLevel: integer("recommended_level").notNull(),
    recommendedSupportType: text("recommended_support_type").notNull(),
    fadingApplied: integer("fading_applied", { mode: "boolean" }).notNull(),
    evidence: text("evidence", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    rationale: text("rationale").notNull(),
    chosenSupportType: text("chosen_support_type"),
    chosenLevel: integer("chosen_level"),
    /** True when the member chose a more direct level than recommended. */
    overridden: integer("overridden", { mode: "boolean" }),
    createdAt: createdAt(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("scaffold_recommendations_participant").on(table.participantId, table.scenarioOrder),
  ]
);

/**
 * Per-member learner model behind adaptive private suggestions (proactive_adaptive
 * only). Learned from this member's own behaviour; never shared between members.
 */
export const learnerModels = sqliteTable(
  "learner_models",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    modelVersion: text("model_version").notNull(),
    policyVersion: text("policy_version").notNull(),
    /** Pre-test score / max score behind the independence prior; null when unknown. */
    pretestFraction: real("pretest_fraction"),
    state: text("state", { mode: "json" }).$type<LearnerState>().notNull(),
    createdAt: createdAt(),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("learner_models_participant_unique").on(table.participantId)]
);

/** Every learner model update with its reason and the state before and after (audit and replay). */
export const learnerModelEvents = sqliteTable(
  "learner_model_events",
  {
    id: id(),
    sessionId: sessionRef(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    scenarioOrder: integer("scenario_order"),
    /** model_created | pace_gaps | offer_response | help_outcome | scenario_outcome | survey_rating */
    eventType: text("event_type").notNull(),
    /** Each update is applied at most once per member. */
    eventKey: text("event_key").notNull(),
    interventionId: text("intervention_id").references(() => interventions.id, {
      onDelete: "set null",
    }),
    /** 1 success, 0 failure, null when the event is not a success/failure observation. */
    reward: real("reward"),
    weight: real("weight").notNull(),
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    stateBefore: text("state_before", { mode: "json" }).$type<LearnerState | null>(),
    stateAfter: text("state_after", { mode: "json" }).$type<LearnerState>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("learner_model_events_key_unique").on(table.participantId, table.eventKey),
    index("learner_model_events_participant").on(table.participantId, table.createdAt),
  ]
);
