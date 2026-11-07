import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getPolicy, hasPolicy } from "@/lib/intervention/policies";
import { capabilitiesFor, conditionOf } from "@/lib/intervention/ResearchConditionManager";
import type { CsvExport } from "@/lib/utils/export";

/**
 * Versioned Adaptive Scaffolding V2 exports. They are separate from the eight
 * original exports (which are unchanged) and only contain V2 groups. Every row
 * repeats the group's condition and policy version so rows stay interpretable
 * when files are combined. Members are identified only by their anonymous id.
 */

export const V2_EXPORT_SCHEMA_VERSION = "v2-export-1";

type CsvValue = string | number | null;
type CsvRow = Record<string, CsvValue>;

const PROVENANCE = [
  "export_schema_version",
  "group",
  "research_condition",
  "intervention_policy_version",
] as const;

const yesNo = (value: boolean | null | undefined) => (value === null || value === undefined ? "" : value ? "yes" : "no");
const secondsBetween = (start: string | null, end: string | null) =>
  start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 1000) : null;

function loadV2Group(sessionId: string) {
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  const assignment = db
    .select()
    .from(schema.studyAssignments)
    .where(eq(schema.studyAssignments.sessionId, sessionId))
    .get();
  if (!session || !assignment) return null;
  const participants = db.select().from(schema.participants).where(eq(schema.participants.sessionId, sessionId)).all();
  const anon = new Map(participants.map((p) => [p.id, p.anonymousId]));
  const studentId = (id: string | null | undefined) => (id ? (anon.get(id) ?? "") : "");

  return {
    session,
    assignment,
    participants,
    studentId,
    provenance: {
      export_schema_version: V2_EXPORT_SCHEMA_VERSION,
      group: session.code,
      research_condition: conditionOf(assignment),
      intervention_policy_version: assignment.interventionPolicyVersion,
    } satisfies CsvRow,
    consents: db
      .select()
      .from(schema.participantConsents)
      .where(eq(schema.participantConsents.sessionId, sessionId))
      .all(),
    attempts: db.select().from(schema.scenarioAttempts).where(eq(schema.scenarioAttempts.sessionId, sessionId)).all(),
    evaluations: db
      .select()
      .from(schema.interventionEvaluations)
      .where(eq(schema.interventionEvaluations.sessionId, sessionId))
      .all()
      .sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt)),
    interventions: db
      .select()
      .from(schema.interventions)
      .where(eq(schema.interventions.sessionId, sessionId))
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    feedback: db
      .select()
      .from(schema.interventionFeedback)
      .where(eq(schema.interventionFeedback.sessionId, sessionId))
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    sharing: db.select().from(schema.aiSharingEvents).where(eq(schema.aiSharingEvents.sessionId, sessionId)).all(),
    recommendations: db
      .select()
      .from(schema.scaffoldRecommendations)
      .where(eq(schema.scaffoldRecommendations.sessionId, sessionId))
      .all(),
    initialIdeas: db
      .select()
      .from(schema.scenarioInitialIdeas)
      .where(eq(schema.scenarioInitialIdeas.sessionId, sessionId))
      .all(),
    roles: db.select().from(schema.groupRoles).where(eq(schema.groupRoles.sessionId, sessionId)).all(),
    checkpoints: db.select().from(schema.groupCheckpoints).where(eq(schema.groupCheckpoints.sessionId, sessionId)).all(),
    agreementReasons: db
      .select()
      .from(schema.scenarioAgreementReasons)
      .where(eq(schema.scenarioAgreementReasons.sessionId, sessionId))
      .all(),
    scaffolds: db
      .select({
        participantId: schema.individualScaffolds.participantId,
        scenarioOrder: schema.individualScaffolds.scenarioOrder,
        createdAt: schema.individualScaffolds.createdAt,
      })
      .from(schema.individualScaffolds)
      .where(eq(schema.individualScaffolds.sessionId, sessionId))
      .all(),
  };
}

type V2Group = NonNullable<ReturnType<typeof loadV2Group>>;

/** Data-quality notes a reader must see next to the numbers. */
export function dataQualityFlags(group: Pick<V2Group, "assignment" | "interventions" | "consents">): string[] {
  const { assignment } = group;
  const flags: string[] = [];
  const origins = new Set(group.interventions.map((i) => i.aiOrigin).filter(Boolean));
  if (assignment.aiModeAtAssignment !== "real") flags.push("mock_ai_at_assignment");
  if (origins.has("mock")) flags.push("mock_ai_output");
  if (origins.has("template_fallback")) flags.push("template_fallback_output");
  if (!hasPolicy(assignment.interventionPolicyVersion) || getPolicy(assignment.interventionPolicyVersion).testOnly) {
    flags.push("test_policy");
  }
  const roster = assignment.frozenRosterIds ?? [];
  if (!assignment.rosterFrozenAt) flags.push("not_started");
  else if (roster.length === 1) flags.push("solo_member");
  if (group.consents.some((c) => c.withdrawnAt)) flags.push("withdrawal_recorded");
  if (group.consents.some((c) => c.droppedOutAt)) flags.push("dropout_recorded");
  return flags;
}

function assignmentRows(group: V2Group): CsvRow[] {
  const { assignment, session } = group;
  const features = assignment.features;
  return [
    {
      ...group.provenance,
      assignment_method: assignment.assignmentMethod,
      created_via: assignment.createdVia,
      study_protocol_version: assignment.studyProtocolVersion,
      consent_version: assignment.consentVersion,
      information_sheet_version: assignment.informationSheetVersion,
      scenario_set_version: assignment.scenarioSetVersion,
      assessment_version: assignment.assessmentVersion,
      model_config_version: assignment.modelConfigVersion,
      ai_mode_at_assignment: assignment.aiModeAtAssignment,
      min_group_size: assignment.minGroupSize,
      max_group_size: assignment.maxGroupSize,
      feature_opening_prompt: yesNo(features.openingPrompt),
      feature_checkpoints: yesNo(features.checkpoints),
      feature_roles: yesNo(features.roles),
      feature_initial_idea: features.initialIdea,
      feature_agreement_reason: features.agreementReason,
      assigned_at_utc: assignment.assignedAt,
      started_at_utc: assignment.rosterFrozenAt,
      roster_size: (assignment.frozenRosterIds ?? []).length,
      members_joined: group.participants.length,
      scenarios_finished: group.attempts.filter((a) => a.submitted).length,
      completed_at_utc: session.completedAt,
      ai_origins_used: [...new Set(group.interventions.map((i) => i.aiOrigin).filter(Boolean))].sort().join(";"),
      data_quality_flags: dataQualityFlags(group).join(";"),
    },
  ];
}

function consentRows(group: V2Group): CsvRow[] {
  const consentBy = new Map(group.consents.map((c) => [c.participantId, c]));
  const roster = new Set(group.assignment.frozenRosterIds ?? []);
  return [...group.participants]
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map((p) => {
      const consent = consentBy.get(p.id);
      return {
        ...group.provenance,
        student_id: p.anonymousId,
        joined_at_utc: p.joinedAt,
        consented: yesNo(!!consent),
        consent_version: consent?.consentVersion ?? null,
        information_sheet_version: consent?.informationSheetVersion ?? null,
        consented_at_utc: consent?.consentedAt ?? null,
        ai_processing_acknowledged: consent ? yesNo(consent.aiProcessingAcknowledged) : null,
        withdrawn_at_utc: consent?.withdrawnAt ?? null,
        dropped_out_at_utc: consent?.droppedOutAt ?? null,
        in_frozen_roster: yesNo(roster.has(p.id)),
      };
    });
}

function evaluationRows(group: V2Group): CsvRow[] {
  return group.evaluations.map((e) => ({
    ...group.provenance,
    scenario_number: e.scenarioOrder,
    evaluation_id: e.id,
    evaluated_at_utc: e.evaluatedAt,
    last_repeated_at_utc: e.lastRepeatedAt,
    repeat_count: e.repeatCount,
    evaluation_source: e.evaluationSource,
    trigger: e.trigger,
    all_triggers: Array.isArray(e.assessments)
      ? [...new Set((e.assessments as { trigger?: string }[]).map((a) => a.trigger ?? ""))].join(";")
      : "",
    assessment_source: e.assessmentSource,
    evidence_summary: e.evidenceSummary,
    evidence_message_count: (e.evidenceMessageIds ?? []).length,
    confidence: e.confidence,
    progress_state: e.progressState,
    decision_action: e.decisionAction,
    decision_scope: e.decisionScope,
    target_student_id: group.studentId(e.targetParticipantId),
    support_type: e.supportType,
    recommended_level: e.recommendedLevel,
    reason_code: e.reasonCode,
    reason_explanation: e.reasonExplanation,
    shadow_only: yesNo(e.shadowOnly),
    online_count: e.onlineCount,
    active_member_count: e.activeMemberCount,
    classifier_model: e.classifierModel,
  }));
}

function interventionRows(group: V2Group): CsvRow[] {
  return group.interventions.map((i) => {
    const feedback = group.feedback.filter((f) => f.interventionId === i.id);
    const count = (action: string) => feedback.filter((f) => f.action === action).length;
    return {
      ...group.provenance,
      scenario_number: i.scenarioOrder,
      intervention_id: i.id,
      evaluation_id: i.evaluationId,
      scope: i.scope,
      recipient_student_id: group.studentId(i.recipientParticipantId),
      initiated_by: i.initiatedBy,
      requested_by_student_id: group.studentId(i.requestedByParticipantId),
      trigger: i.trigger,
      category: i.category,
      support_type: i.supportType,
      scaffold_level: i.scaffoldLevel,
      status: i.status,
      reason_code: i.reasonCode,
      created_at_utc: i.createdAt,
      accepted_at_utc: i.acceptedAt,
      accepted_by_student_id: group.studentId(i.acceptedByParticipantId),
      delivered_at_utc: i.deliveredAt,
      resolved_at_utc: i.resolvedAt,
      expires_at_utc: i.expiresAt,
      seconds_to_accept: secondsBetween(i.createdAt, i.acceptedAt),
      ai_origin: i.aiOrigin,
      ai_model: i.aiModel,
      prompt_version: i.promptVersion,
      ai_latency_ms: i.aiLatencyMs,
      input_tokens: i.inputTokens,
      output_tokens: i.outputTokens,
      failure_reason: i.failureReason,
      offer_text: i.offerText,
      content: i.content,
      viewed_count: count("viewed"),
      accepted_count: count("accepted"),
      dismissed_count: count("dismissed"),
      deferred_count: count("deferred"),
      why_viewed_count: count("why_viewed"),
      shared_count: count("shared"),
    };
  });
}

function feedbackRows(group: V2Group): CsvRow[] {
  const byId = new Map(group.interventions.map((i) => [i.id, i]));
  return group.feedback.map((f) => {
    const intervention = byId.get(f.interventionId);
    return {
      ...group.provenance,
      scenario_number: intervention?.scenarioOrder ?? null,
      intervention_id: f.interventionId,
      intervention_scope: intervention?.scope ?? null,
      intervention_initiated_by: intervention?.initiatedBy ?? null,
      support_type: intervention?.supportType ?? null,
      student_id: group.studentId(f.participantId),
      action: f.action,
      comment: f.comment,
      at_utc: f.createdAt,
    };
  });
}

function sharingRows(group: V2Group): CsvRow[] {
  return [...group.sharing]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((s) => ({
      ...group.provenance,
      scenario_number: s.scenarioOrder,
      student_id: group.studentId(s.participantId),
      source_type: s.sourceType,
      source_id: s.sourceId,
      source_support_type: s.sourceSupportType,
      shared_text: s.sharedText,
      shared_at_utc: s.createdAt,
    }));
}

function recommendationRows(group: V2Group): CsvRow[] {
  return [...group.recommendations]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({
      ...group.provenance,
      scenario_number: r.scenarioOrder,
      student_id: group.studentId(r.participantId),
      engine_version: r.engineVersion,
      recommended_level: r.recommendedLevel,
      recommended_support_type: r.recommendedSupportType,
      fading_applied: yesNo(r.fadingApplied),
      rationale: r.rationale,
      chosen_support_type: r.chosenSupportType,
      chosen_level: r.chosenLevel,
      chose_more_direct_than_recommended: yesNo(r.overridden),
      intervention_id: r.interventionId,
      created_at_utc: r.createdAt,
      resolved_at_utc: r.resolvedAt,
      evidence_json: JSON.stringify(r.evidence),
    }));
}

function initialIdeaRows(group: V2Group): CsvRow[] {
  return [...group.initialIdeas]
    .sort((a, b) => a.scenarioOrder - b.scenarioOrder || a.createdAt.localeCompare(b.createdAt))
    .map((idea) => {
      const firstAi = group.scaffolds
        .filter((s) => s.participantId === idea.participantId && s.scenarioOrder === idea.scenarioOrder)
        .map((s) => s.createdAt)
        .sort()[0];
      return {
        ...group.provenance,
        scenario_number: idea.scenarioOrder,
        student_id: group.studentId(idea.participantId),
        initial_idea: idea.text,
        written_at_utc: idea.createdAt,
        first_private_ai_at_utc: firstAi ?? null,
        written_before_private_ai: yesNo(!firstAi || idea.createdAt <= firstAi),
      };
    });
}

function roleRows(group: V2Group): CsvRow[] {
  return [...group.roles]
    .sort((a, b) => a.scenarioOrder - b.scenarioOrder || a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({
      ...group.provenance,
      scenario_number: r.scenarioOrder,
      student_id: group.studentId(r.participantId),
      role: r.role,
      matches_suggested_rotation: yesNo(r.matchesRotation),
      chosen_at_utc: r.createdAt,
    }));
}

function checkpointRows(group: V2Group): CsvRow[] {
  return [...group.checkpoints]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((c) => ({
      ...group.provenance,
      scenario_number: c.scenarioOrder,
      raised_by_student_id: group.studentId(c.participantId),
      kind: c.kind,
      raised_at_utc: c.createdAt,
    }));
}

function agreementReasonRows(group: V2Group): CsvRow[] {
  return [...group.agreementReasons]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({
      ...group.provenance,
      scenario_number: r.scenarioOrder,
      student_id: group.studentId(r.participantId),
      reason: r.reason,
      at_utc: r.createdAt,
    }));
}

interface V2ExportDefinition {
  label: string;
  description: string;
  columns: string[];
  rows: (group: V2Group) => CsvRow[];
}

const withProvenance = (columns: string[]) => [...PROVENANCE, ...columns];

export const V2_EXPORTS = {
  v2_assignment: {
    label: "V2 study assignment and provenance",
    description: "One row per group: mode, condition, every version, features, roster, AI origins used and data-quality flags",
    columns: withProvenance([
      "assignment_method",
      "created_via",
      "study_protocol_version",
      "consent_version",
      "information_sheet_version",
      "scenario_set_version",
      "assessment_version",
      "model_config_version",
      "ai_mode_at_assignment",
      "min_group_size",
      "max_group_size",
      "feature_opening_prompt",
      "feature_checkpoints",
      "feature_roles",
      "feature_initial_idea",
      "feature_agreement_reason",
      "assigned_at_utc",
      "started_at_utc",
      "roster_size",
      "members_joined",
      "scenarios_finished",
      "completed_at_utc",
      "ai_origins_used",
      "data_quality_flags",
    ]),
    rows: assignmentRows,
  },
  v2_consents: {
    label: "V2 consent records",
    description: "One row per member: consent version and time, withdrawal, drop-out, roster membership",
    columns: withProvenance([
      "student_id",
      "joined_at_utc",
      "consented",
      "consent_version",
      "information_sheet_version",
      "consented_at_utc",
      "ai_processing_acknowledged",
      "withdrawn_at_utc",
      "dropped_out_at_utc",
      "in_frozen_roster",
    ]),
    rows: consentRows,
  },
  v2_evaluations: {
    label: "V2 intervention decisions (including no-action)",
    description: "Every logged evaluation: trigger, evidence, decision, reason code, shadow flag, repeat count",
    columns: withProvenance([
      "scenario_number",
      "evaluation_id",
      "evaluated_at_utc",
      "last_repeated_at_utc",
      "repeat_count",
      "evaluation_source",
      "trigger",
      "all_triggers",
      "assessment_source",
      "evidence_summary",
      "evidence_message_count",
      "confidence",
      "progress_state",
      "decision_action",
      "decision_scope",
      "target_student_id",
      "support_type",
      "recommended_level",
      "reason_code",
      "reason_explanation",
      "shadow_only",
      "online_count",
      "active_member_count",
      "classifier_model",
    ]),
    rows: evaluationRows,
  },
  v2_interventions: {
    label: "V2 interventions",
    description: "Every offer or request: scope, status timeline, AI origin/model/prompt version, content and response counts",
    columns: withProvenance([
      "scenario_number",
      "intervention_id",
      "evaluation_id",
      "scope",
      "recipient_student_id",
      "initiated_by",
      "requested_by_student_id",
      "trigger",
      "category",
      "support_type",
      "scaffold_level",
      "status",
      "reason_code",
      "created_at_utc",
      "accepted_at_utc",
      "accepted_by_student_id",
      "delivered_at_utc",
      "resolved_at_utc",
      "expires_at_utc",
      "seconds_to_accept",
      "ai_origin",
      "ai_model",
      "prompt_version",
      "ai_latency_ms",
      "input_tokens",
      "output_tokens",
      "failure_reason",
      "offer_text",
      "content",
      "viewed_count",
      "accepted_count",
      "dismissed_count",
      "deferred_count",
      "why_viewed_count",
      "shared_count",
    ]),
    rows: interventionRows,
  },
  v2_feedback: {
    label: "V2 responses to interventions",
    description: "Each member action on an intervention: viewed, accepted, dismissed, not now, why, shared",
    columns: withProvenance([
      "scenario_number",
      "intervention_id",
      "intervention_scope",
      "intervention_initiated_by",
      "support_type",
      "student_id",
      "action",
      "comment",
      "at_utc",
    ]),
    rows: feedbackRows,
  },
  v2_sharing: {
    label: "V2 shared AI ideas",
    description: "Text members explicitly chose to share from private AI support (not proof anyone read it)",
    columns: withProvenance([
      "scenario_number",
      "student_id",
      "source_type",
      "source_id",
      "source_support_type",
      "shared_text",
      "shared_at_utc",
    ]),
    rows: sharingRows,
  },
  v2_recommendations: {
    label: "V2 adaptive recommendations",
    description: "Recommended private support level, fading, evidence, and what the member chose",
    columns: withProvenance([
      "scenario_number",
      "student_id",
      "engine_version",
      "recommended_level",
      "recommended_support_type",
      "fading_applied",
      "rationale",
      "chosen_support_type",
      "chosen_level",
      "chose_more_direct_than_recommended",
      "intervention_id",
      "created_at_utc",
      "resolved_at_utc",
      "evidence_json",
    ]),
    rows: recommendationRows,
  },
  v2_initial_ideas: {
    label: "V2 initial individual ideas",
    description: "Private first idea per member and scenario, and whether it was written before private AI use",
    columns: withProvenance([
      "scenario_number",
      "student_id",
      "initial_idea",
      "written_at_utc",
      "first_private_ai_at_utc",
      "written_before_private_ai",
    ]),
    rows: initialIdeaRows,
  },
  v2_roles: {
    label: "V2 role cards",
    description: "Roles members chose per scenario and whether they matched the suggested rotation",
    columns: withProvenance(["scenario_number", "student_id", "role", "matches_suggested_rotation", "chosen_at_utc"]),
    rows: roleRows,
  },
  v2_checkpoints: {
    label: "V2 checkpoints raised",
    description: "Non-AI checkpoint questions members raised for their group",
    columns: withProvenance(["scenario_number", "raised_by_student_id", "kind", "raised_at_utc"]),
    rows: checkpointRows,
  },
  v2_agreement_reasons: {
    label: "V2 agreement reasons",
    description: "Members' one-sentence reasons when clicking \"I am good\"",
    columns: withProvenance(["scenario_number", "student_id", "reason", "at_utc"]),
    rows: agreementReasonRows,
  },
} satisfies Record<string, V2ExportDefinition>;

export type V2ExportType = keyof typeof V2_EXPORTS;

export function isV2ExportType(value: string): value is V2ExportType {
  return value in V2_EXPORTS;
}

/** One V2 group, or several (e.g. every V2 group) in one file. */
export function buildV2Export(type: V2ExportType, sessionIds: string[]): CsvExport {
  const definition: V2ExportDefinition = V2_EXPORTS[type];
  const rows: CsvRow[] = [];
  for (const sessionId of sessionIds) {
    const group = loadV2Group(sessionId);
    if (group) rows.push(...definition.rows(group));
  }
  return { columns: definition.columns, rows };
}

/** Every V2 group, oldest first. Legacy groups have no assignment and are never included. */
export function listV2SessionIds(): string[] {
  return db
    .select({ sessionId: schema.studyAssignments.sessionId })
    .from(schema.studyAssignments)
    .orderBy(asc(schema.studyAssignments.assignedAt))
    .all()
    .map((row) => row.sessionId);
}

/** Researcher dashboard summary for one V2 group (counts, failures, warnings). */
export function buildV2Dashboard(sessionId: string) {
  const group = loadV2Group(sessionId);
  if (!group) return null;
  const { assignment } = group;
  const condition = conditionOf(assignment);
  const tally = (values: (string | null)[], weights?: number[]) =>
    values.reduce<Record<string, number>>((acc, value, index) => {
      const key = value ?? "none";
      acc[key] = (acc[key] ?? 0) + (weights?.[index] ?? 1);
      return acc;
    }, {});
  const roster = assignment.frozenRosterIds ?? [];
  const consentBy = new Map(group.consents.map((c) => [c.participantId, c]));

  const warnings: string[] = [];
  const unconsented = group.participants.filter((p) => !consentBy.has(p.id));
  if (unconsented.length) warnings.push(`${unconsented.length} joined member(s) have not given consent.`);
  if (assignment.aiModeAtAssignment !== "real") {
    warnings.push("This group was created without an OpenAI API key, so AI support uses demo text.");
  }
  if (group.interventions.some((i) => i.aiOrigin === "mock")) {
    warnings.push("Some AI support in this group is demo text (no API key), not real AI output.");
  }
  if (!hasPolicy(assignment.interventionPolicyVersion) || getPolicy(assignment.interventionPolicyVersion).testOnly) {
    warnings.push("This group uses the test-only policy (seconds-scale timing).");
  }
  if (roster.length === 1) warnings.push("Only one member is in the roster: this is not a group study.");
  if (group.interventions.some((i) => i.aiOrigin === "template_fallback")) {
    warnings.push("Some AI output was rejected by the validator and replaced by a template.");
  }
  const failures = group.interventions.filter((i) => i.status === "failed");
  if (failures.length) warnings.push(`${failures.length} intervention(s) failed to generate.`);
  const capabilities = capabilitiesFor(condition);
  if (!capabilities.proactiveGroup && group.interventions.some((i) => i.initiatedBy === "system")) {
    warnings.push("Proactive interventions exist although this condition does not allow them.");
  }
  if (!capabilities.proactivePrivate && group.interventions.some((i) => i.scope === "individual")) {
    warnings.push("Private interventions exist although this condition does not allow them.");
  }

  return {
    group: group.session.code,
    assignment: {
      condition,
      assignmentMethod: assignment.assignmentMethod,
      createdVia: assignment.createdVia,
      interventionPolicyVersion: assignment.interventionPolicyVersion,
      studyProtocolVersion: assignment.studyProtocolVersion,
      consentVersion: assignment.consentVersion,
      modelConfigVersion: assignment.modelConfigVersion,
      aiModeAtAssignment: assignment.aiModeAtAssignment,
      features: assignment.features,
      assignedAt: assignment.assignedAt,
      startedAt: assignment.rosterFrozenAt,
    },
    members: [...group.participants]
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
      .map((p) => {
        const consent = consentBy.get(p.id);
        return {
          id: p.id,
          name: p.displayName,
          studentId: p.anonymousId,
          consented: !!consent,
          withdrawn: !!consent?.withdrawnAt,
          droppedOut: !!consent?.droppedOutAt,
          inRoster: roster.includes(p.id),
        };
      }),
    counts: {
      evaluations: group.evaluations.reduce((sum, e) => sum + e.repeatCount, 0),
      evaluationRows: group.evaluations.length,
      decisions: tally(
        group.evaluations.map((e) => e.decisionAction),
        group.evaluations.map((e) => e.repeatCount)
      ),
      reasonCodes: tally(
        group.evaluations.map((e) => e.reasonCode),
        group.evaluations.map((e) => e.repeatCount)
      ),
      triggers: tally(group.evaluations.filter((e) => e.trigger !== "none").map((e) => e.trigger)),
      interventionsByStatus: tally(group.interventions.map((i) => i.status)),
      interventionsByScope: tally(group.interventions.map((i) => `${i.scope}/${i.initiatedBy}`)),
      aiOrigins: tally(group.interventions.map((i) => i.aiOrigin)),
      feedback: tally(group.feedback.map((f) => f.action)),
      shared: group.sharing.length,
      recommendations: group.recommendations.length,
      recommendationsOverridden: group.recommendations.filter((r) => r.overridden).length,
    },
    failures: failures.map((f) => ({
      id: f.id,
      scenarioOrder: f.scenarioOrder,
      supportType: f.supportType,
      reason: f.failureReason,
      at: f.resolvedAt,
    })),
    timeline: group.interventions.map((i) => ({
      id: i.id,
      scenarioOrder: i.scenarioOrder,
      createdAt: i.createdAt,
      scope: i.scope,
      initiatedBy: i.initiatedBy,
      trigger: i.trigger,
      supportType: i.supportType,
      status: i.status,
      aiOrigin: i.aiOrigin,
      reasonCode: i.reasonCode,
    })),
    dataQualityFlags: dataQualityFlags(group),
    warnings,
  };
}