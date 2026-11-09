import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { OPEN_RUBRIC_CRITERIA } from "@/lib/intervention/learning/OpenAnswerRubric";
import { systemNecessity } from "@/lib/intervention/learning/ReviewAgreement";
import { conditionOf } from "@/lib/intervention/ResearchConditionManager";
import type { CsvExport } from "@/lib/utils/export";

/**
 * Versioned Adaptive Scaffolding V2.3 exports (policy-v2-3 and later). They add
 * to the 8 original and 13 V2 exports, which are unchanged. Groups on older
 * policies simply have no rows here, except researcher review labels and the
 * optional open-answer rubric, which may be recorded for any V2 group.
 *
 * Terms are kept apart on purpose: proposed (an offer row exists), delivered
 * (content generated), seen (displayed on screen; not proof of reading),
 * accepted (member clicked), effective proxy (observed outcome, associational)
 * and human rated (researcher label).
 */

export const V23_EXPORT_SCHEMA_VERSION = "v2-3-export-1";

type CsvValue = string | number | null;
type CsvRow = Record<string, CsvValue>;

const PROVENANCE = [
  "export_schema_version",
  "group",
  "research_condition",
  "intervention_policy_version",
] as const;

const yesNo = (value: boolean | null | undefined) => (value === null || value === undefined ? "" : value ? "yes" : "no");
const json = (value: unknown) => (value === null || value === undefined ? "" : JSON.stringify(value));
const byTime = <T>(rows: T[], key: (row: T) => string) => [...rows].sort((a, b) => key(a).localeCompare(key(b)));

const SEEN_KINDS = new Set(["client_displayed_in_viewport", "user_opened", "accepted", "deferred", "dismissed"]);

function loadV23Group(sessionId: string) {
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
    studentId,
    provenance: {
      export_schema_version: V23_EXPORT_SCHEMA_VERSION,
      group: session.code,
      research_condition: conditionOf(assignment),
      intervention_policy_version: assignment.interventionPolicyVersion,
    } satisfies CsvRow,
    activeRoster: assignment.frozenRosterIds ?? [],
    interventions: db.select().from(schema.interventions).where(eq(schema.interventions.sessionId, sessionId)).all(),
    evaluations: db
      .select()
      .from(schema.interventionEvaluations)
      .where(eq(schema.interventionEvaluations.sessionId, sessionId))
      .all(),
    feedback: db.select().from(schema.interventionFeedback).where(eq(schema.interventionFeedback.sessionId, sessionId)).all(),
    estimates: db.select().from(schema.groupStateEstimates).where(eq(schema.groupStateEstimates.sessionId, sessionId)).all(),
    traces: db.select().from(schema.privateDecisionTraces).where(eq(schema.privateDecisionTraces.sessionId, sessionId)).all(),
    scaffolding: db
      .select()
      .from(schema.scaffoldingStateEvents)
      .where(eq(schema.scaffoldingStateEvents.sessionId, sessionId))
      .all(),
    exposures: db.select().from(schema.offerExposures).where(eq(schema.offerExposures.sessionId, sessionId)).all(),
    outcomes: db
      .select()
      .from(schema.interventionOutcomeEvaluations)
      .where(eq(schema.interventionOutcomeEvaluations.sessionId, sessionId))
      .all(),
    progress: db
      .select()
      .from(schema.interventionProgressFeedback)
      .where(eq(schema.interventionProgressFeedback.sessionId, sessionId))
      .all(),
    labels: db.select().from(schema.humanReviewLabels).where(eq(schema.humanReviewLabels.sessionId, sessionId)).all(),
    rubric: db
      .select()
      .from(schema.openAnswerRubricScores)
      .where(eq(schema.openAnswerRubricScores.sessionId, sessionId))
      .all(),
  };
}

type V23Group = NonNullable<ReturnType<typeof loadV23Group>>;

function groupStateRows(group: V23Group): CsvRow[] {
  const evaluations = new Map(group.evaluations.map((e) => [e.id, e]));
  return byTime(group.estimates, (e) => e.estimatedAt).map((e) => {
    const evaluation = e.evaluationId ? evaluations.get(e.evaluationId) : undefined;
    return {
      ...group.provenance,
      scenario_number: e.scenarioOrder,
      estimate_id: e.id,
      evaluation_id: e.evaluationId ?? "",
      estimated_at_utc: e.estimatedAt,
      last_repeated_at_utc: e.lastRepeatedAt ?? "",
      repeat_count: e.repeatCount,
      estimator_version: e.estimatorVersion,
      stage: e.stage,
      state: e.state,
      confidence_heuristic: e.confidence,
      evidence_count: e.evidence.length,
      counter_evidence_count: e.counterEvidence.length,
      uncertainty_reasons: e.uncertaintyReasons.join(";"),
      state_reasons: e.stateReasons.join(";"),
      classifier_model: e.classifierModel ?? "",
      classifier_note: e.classifierNote ?? "",
      decision_action: evaluation?.decisionAction ?? "",
      decision_reason_code: evaluation?.reasonCode ?? "",
      evidence_json: json(e.evidence),
      counter_evidence_json: json(e.counterEvidence),
    };
  });
}

/** Decision seeds start with the internal member id; the export carries the anonymous id instead. */
function pseudonymizeSeed(evidence: Record<string, unknown>, participantId: string, anonymousId: string) {
  const seed = evidence.seed;
  if (typeof seed !== "string" || !seed.startsWith(`${participantId}|`)) return evidence;
  return { ...evidence, seed: `${anonymousId}${seed.slice(participantId.length)}` };
}

function privateDecisionRows(group: V23Group): CsvRow[] {
  const estimates = new Map(group.estimates.map((e) => [e.id, e]));
  return byTime(group.traces, (t) => t.decidedAt).map((t) => {
    const estimate = t.groupStateEstimateId ? estimates.get(t.groupStateEstimateId) : undefined;
    return {
      ...group.provenance,
      scenario_number: t.scenarioOrder,
      trace_id: t.id,
      student_id: group.studentId(t.participantId),
      decided_at_utc: t.decidedAt,
      last_repeated_at_utc: t.lastRepeatedAt ?? "",
      repeat_count: t.repeatCount,
      model_version: t.modelVersion,
      reward_version: t.rewardVersion,
      scaffolding_version: t.scaffoldingVersion,
      action: t.action,
      reason_code: t.reasonCode,
      tier: t.tier,
      move: t.move,
      support_type: t.supportType ?? "",
      intervention_id: t.interventionId ?? "",
      group_state: estimate?.state ?? "",
      group_state_confidence_heuristic: estimate?.confidence ?? null,
      evidence_json: json(pseudonymizeSeed(t.evidence, t.participantId, group.studentId(t.participantId))),
    };
  });
}

function scaffoldingRows(group: V23Group): CsvRow[] {
  return byTime(group.scaffolding, (s) => s.createdAt).map((s) => ({
    ...group.provenance,
    scenario_number: s.scenarioOrder,
    student_id: group.studentId(s.participantId),
    scaffolding_version: s.scaffoldingVersion,
    event_type: s.eventType,
    from_tier: s.fromTier ?? "",
    to_tier: s.toTier,
    move: s.move,
    reason_code: s.reasonCode,
    intervention_id: s.interventionId ?? "",
    event_key: s.eventKey,
    at_utc: s.createdAt,
    detail_json: json(s.detail),
  }));
}

function exposureRows(group: V23Group): CsvRow[] {
  const interventions = new Map(group.interventions.map((i) => [i.id, i]));
  return byTime(group.exposures, (e) => e.serverAt).map((e) => {
    const intervention = interventions.get(e.interventionId);
    return {
      ...group.provenance,
      scenario_number: e.scenarioOrder,
      intervention_id: e.interventionId,
      intervention_scope: intervention?.scope ?? "",
      intervention_initiated_by: intervention?.initiatedBy ?? "",
      support_type: intervention?.supportType ?? "",
      student_id: group.studentId(e.participantId),
      kind: e.kind,
      counts_as_seen: yesNo(SEEN_KINDS.has(e.kind) || e.kind === "expired_seen"),
      source: e.source,
      server_at_utc: e.serverAt,
      client_at_utc: e.clientAt ?? "",
      client_clock_rejected: yesNo(e.clientClockRejected),
    };
  });
}

function outcomeRows(group: V23Group): CsvRow[] {
  const interventions = new Map(group.interventions.map((i) => [i.id, i]));
  return byTime(group.outcomes, (o) => o.evaluatedAt).map((o) => {
    const intervention = interventions.get(o.interventionId);
    return {
      ...group.provenance,
      scenario_number: o.scenarioOrder,
      intervention_id: o.interventionId,
      scope: o.scope,
      subject: o.subjectKey === "group" ? "group" : group.studentId(o.participantId),
      trigger: intervention?.trigger ?? "",
      support_type: intervention?.supportType ?? "",
      window_start_utc: o.windowStart,
      window_end_utc: o.windowEnd,
      activity_resumed: yesNo(o.activityResumed),
      difficulty_resolved_proxy: o.difficultyResolved,
      resolution_source: o.resolutionSource,
      understanding_evidence: o.understandingEvidence,
      participant_feedback: o.participantFeedback ?? "",
      was_visible: yesNo(o.wasVisible),
      escalated_help: yesNo(o.escalatedHelp),
      confounds: o.confounds.join(";"),
      validity: o.validity,
      evaluator_version: o.evaluatorVersion,
      reward_version: o.rewardVersion ?? "",
      learner_update_applied: yesNo(o.updateApplied),
      learner_event_key: o.learnerEventKey ?? "",
      evaluated_at_utc: o.evaluatedAt,
      amended_at_utc: o.amendedAt ?? "",
      provenance_json: json(o.provenance),
    };
  });
}

function progressFeedbackRows(group: V23Group): CsvRow[] {
  const interventions = new Map(group.interventions.map((i) => [i.id, i]));
  return byTime(group.progress, (p) => p.createdAt).map((p) => {
    const intervention = interventions.get(p.interventionId);
    return {
      ...group.provenance,
      scenario_number: p.scenarioOrder,
      intervention_id: p.interventionId,
      intervention_scope: intervention?.scope ?? "",
      support_type: intervention?.supportType ?? "",
      student_id: group.studentId(p.participantId),
      response: p.response,
      at_utc: p.createdAt,
    };
  });
}

/** One row per proactive offer and member who could receive it: the funnel from proposed to human rated. */
function offerFunnelRows(group: V23Group): CsvRow[] {
  const rows: CsvRow[] = [];
  const proactive = byTime(
    group.interventions.filter((i) => i.initiatedBy === "system"),
    (i) => i.createdAt
  );
  for (const offer of proactive) {
    const exposures = group.exposures.filter((e) => e.interventionId === offer.id);
    if (exposures.length === 0) continue;
    const members =
      offer.scope === "group" ? group.activeRoster : offer.recipientParticipantId ? [offer.recipientParticipantId] : [];
    const labels = group.labels.filter((l) => l.targetType === "intervention" && l.targetId === offer.id);
    for (const participantId of members) {
      const kinds = new Set(exposures.filter((e) => e.participantId === participantId).map((e) => e.kind));
      const decisions = byTime(
        group.feedback.filter(
          (f) => f.interventionId === offer.id && f.participantId === participantId && ["accepted", "dismissed", "deferred"].includes(f.action)
        ),
        (f) => f.createdAt
      );
      const outcome = group.outcomes.find(
        (o) => o.interventionId === offer.id && o.subjectKey === (offer.scope === "group" ? "group" : participantId)
      );
      const progress = group.progress.find((p) => p.interventionId === offer.id && p.participantId === participantId);
      rows.push({
        ...group.provenance,
        scenario_number: offer.scenarioOrder,
        intervention_id: offer.id,
        scope: offer.scope,
        trigger: offer.trigger,
        support_type: offer.supportType,
        student_id: group.studentId(participantId),
        proposed: "yes",
        server_created: yesNo(kinds.has("server_created")),
        socket_delivered: yesNo(kinds.has("socket_delivered")),
        seen: yesNo([...kinds].some((k) => SEEN_KINDS.has(k)) || kinds.has("expired_seen")),
        own_response: decisions.at(-1)?.action ?? "none",
        accepted_by_anyone: yesNo(Boolean(offer.acceptedAt)),
        content_delivered: yesNo(offer.status === "delivered"),
        final_status: offer.status,
        effective_proxy: outcome?.difficultyResolved ?? "",
        effective_proxy_validity: outcome?.validity ?? "",
        progress_feedback: progress?.response ?? "",
        human_rated_count: labels.length,
      });
    }
  }
  return rows;
}

function reviewLabelRows(group: V23Group): CsvRow[] {
  const evaluations = new Map(group.evaluations.map((e) => [e.id, e]));
  const interventions = new Map(group.interventions.map((i) => [i.id, i]));
  const estimateByEvaluation = new Map(
    byTime(group.estimates, (e) => e.estimatedAt)
      .filter((e) => e.evaluationId)
      .map((e) => [e.evaluationId!, e])
  );
  return byTime(group.labels, (l) => l.createdAt).map((l) => {
    const evaluationId =
      l.targetType === "evaluation" ? l.targetId : (interventions.get(l.targetId)?.evaluationId ?? null);
    const evaluation = evaluationId ? evaluations.get(evaluationId) : undefined;
    const estimate = evaluationId ? estimateByEvaluation.get(evaluationId) : undefined;
    return {
      ...group.provenance,
      scenario_number: l.scenarioOrder,
      target_type: l.targetType,
      target_id: l.targetId,
      rater_id: l.raterId,
      blind: yesNo(l.blind),
      necessity: l.necessity,
      support_appropriateness: l.supportAppropriateness ?? "",
      disagreement_label: l.disagreementLabel ?? "",
      state_label: l.stateLabel ?? "",
      system_decision_action: evaluation?.decisionAction ?? "",
      system_necessity: evaluation ? systemNecessity(evaluation.decisionAction) : "",
      system_state: estimate?.state ?? "",
      review_protocol_version: l.reviewProtocolVersion,
      notes: l.notes ?? "",
      created_at_utc: l.createdAt,
      updated_at_utc: l.updatedAt,
    };
  });
}

function openRubricRows(group: V23Group): CsvRow[] {
  return byTime(group.rubric, (r) => r.createdAt).map((r) => ({
    ...group.provenance,
    student_id: group.studentId(r.participantId),
    assessment_type: r.assessmentType,
    question_id: r.questionId,
    rubric_version: r.rubricVersion,
    ...Object.fromEntries(OPEN_RUBRIC_CRITERIA.map(({ key }) => [key, r.criteria[key] ?? null])),
    open_application_rubric_score: r.openApplicationRubricScore,
    rater_id: r.raterId,
    blind: yesNo(r.blind),
    notes: r.notes ?? "",
    created_at_utc: r.createdAt,
    updated_at_utc: r.updatedAt,
  }));
}

interface V23ExportDefinition {
  label: string;
  description: string;
  columns: string[];
  rows: (group: V23Group) => CsvRow[];
}

const withProvenance = (columns: string[]) => [...PROVENANCE, ...columns];

export const V23_EXPORTS = {
  v2_3_group_states: {
    label: "V2.3 group-state estimates",
    description:
      "Estimated collaboration stage and state behind each evaluation, with heuristic confidence (not a probability), evidence, counter-evidence and uncertainty reasons",
    columns: withProvenance([
      "scenario_number",
      "estimate_id",
      "evaluation_id",
      "estimated_at_utc",
      "last_repeated_at_utc",
      "repeat_count",
      "estimator_version",
      "stage",
      "state",
      "confidence_heuristic",
      "evidence_count",
      "counter_evidence_count",
      "uncertainty_reasons",
      "state_reasons",
      "classifier_model",
      "classifier_note",
      "decision_action",
      "decision_reason_code",
      "evidence_json",
      "counter_evidence_json",
    ]),
    rows: groupStateRows,
  },
  v2_3_private_decisions: {
    label: "V2.3 private decision traces",
    description: "Every adaptive private decision per member, including waits, with reason, scaffolding tier and the group estimate it used",
    columns: withProvenance([
      "scenario_number",
      "trace_id",
      "student_id",
      "decided_at_utc",
      "last_repeated_at_utc",
      "repeat_count",
      "model_version",
      "reward_version",
      "scaffolding_version",
      "action",
      "reason_code",
      "tier",
      "move",
      "support_type",
      "intervention_id",
      "group_state",
      "group_state_confidence_heuristic",
      "evidence_json",
    ]),
    rows: privateDecisionRows,
  },
  v2_3_scaffolding_events: {
    label: "V2.3 scaffolding state (fading and escalation)",
    description: "Fading, escalation, reassessment and \"don't suggest again\" events per member and scenario",
    columns: withProvenance([
      "scenario_number",
      "student_id",
      "scaffolding_version",
      "event_type",
      "from_tier",
      "to_tier",
      "move",
      "reason_code",
      "intervention_id",
      "event_key",
      "at_utc",
      "detail_json",
    ]),
    rows: scaffoldingRows,
  },
  v2_3_exposures: {
    label: "V2.3 offer exposure",
    description:
      "Per member: created, delivered to the device, displayed on screen, opened, responded, expired seen/unseen. Displayed means on screen, not read",
    columns: withProvenance([
      "scenario_number",
      "intervention_id",
      "intervention_scope",
      "intervention_initiated_by",
      "support_type",
      "student_id",
      "kind",
      "counts_as_seen",
      "source",
      "server_at_utc",
      "client_at_utc",
      "client_clock_rejected",
    ]),
    rows: exposureRows,
  },
  v2_3_outcomes: {
    label: "V2.3 observed outcomes (proxy)",
    description:
      "After delivered proactive support: activity, difficulty resolved (proxy), feedback, visibility, confounds and validity. Associational, not causal; understanding is not assessed",
    columns: withProvenance([
      "scenario_number",
      "intervention_id",
      "scope",
      "subject",
      "trigger",
      "support_type",
      "window_start_utc",
      "window_end_utc",
      "activity_resumed",
      "difficulty_resolved_proxy",
      "resolution_source",
      "understanding_evidence",
      "participant_feedback",
      "was_visible",
      "escalated_help",
      "confounds",
      "validity",
      "evaluator_version",
      "reward_version",
      "learner_update_applied",
      "learner_event_key",
      "evaluated_at_utc",
      "amended_at_utc",
      "provenance_json",
    ]),
    rows: outcomeRows,
  },
  v2_3_progress_feedback: {
    label: "V2.3 one-click progress feedback",
    description: "Voluntary \"Did this help you make progress?\" answers (operational, not a study instrument). Missing answers are absent, not negative",
    columns: withProvenance([
      "scenario_number",
      "intervention_id",
      "intervention_scope",
      "support_type",
      "student_id",
      "response",
      "at_utc",
    ]),
    rows: progressFeedbackRows,
  },
  v2_3_offer_funnel: {
    label: "V2.3 offer funnel per member",
    description:
      "Proposed, delivered to device, seen, own response, accepted by anyone, content delivered, effective proxy and human-rated count, kept as separate columns",
    columns: withProvenance([
      "scenario_number",
      "intervention_id",
      "scope",
      "trigger",
      "support_type",
      "student_id",
      "proposed",
      "server_created",
      "socket_delivered",
      "seen",
      "own_response",
      "accepted_by_anyone",
      "content_delivered",
      "final_status",
      "effective_proxy",
      "effective_proxy_validity",
      "progress_feedback",
      "human_rated_count",
    ]),
    rows: offerFunnelRows,
  },
  v2_3_review_labels: {
    label: "V2.3 human review labels",
    description: "Researcher labels on pseudonymized decision windows next to the system's decision and estimated state",
    columns: withProvenance([
      "scenario_number",
      "target_type",
      "target_id",
      "rater_id",
      "blind",
      "necessity",
      "support_appropriateness",
      "disagreement_label",
      "state_label",
      "system_decision_action",
      "system_necessity",
      "system_state",
      "review_protocol_version",
      "notes",
      "created_at_utc",
      "updated_at_utc",
    ]),
    rows: reviewLabelRows,
  },
  v2_3_open_rubric: {
    label: "V2.3 optional open-answer rubric",
    description: "Optional researcher rubric for written question 9 (0-4), separate from the unchanged 0-8 multiple-choice score",
    columns: withProvenance([
      "student_id",
      "assessment_type",
      "question_id",
      "rubric_version",
      ...OPEN_RUBRIC_CRITERIA.map(({ key }) => key),
      "open_application_rubric_score",
      "rater_id",
      "blind",
      "notes",
      "created_at_utc",
      "updated_at_utc",
    ]),
    rows: openRubricRows,
  },
} satisfies Record<string, V23ExportDefinition>;

export type V23ExportType = keyof typeof V23_EXPORTS;

export function isV23ExportType(value: string): value is V23ExportType {
  return value in V23_EXPORTS;
}

export function buildV23Export(type: V23ExportType, sessionIds: string[]): CsvExport {
  const definition: V23ExportDefinition = V23_EXPORTS[type];
  const rows: CsvRow[] = [];
  for (const sessionId of sessionIds) {
    const group = loadV23Group(sessionId);
    if (group) rows.push(...definition.rows(group));
  }
  return { columns: definition.columns, rows };
}

/** Researcher dashboard section for one group; null when the group has no V2.3 data at all. */
export function buildV23Dashboard(sessionId: string) {
  const group = loadV23Group(sessionId);
  if (!group) return null;
  const hasData = group.estimates.length + group.traces.length + group.exposures.length + group.labels.length > 0;
  if (!hasData) return null;
  const tally = (values: string[], weights?: number[]) =>
    values.reduce<Record<string, number>>((acc, value, index) => {
      acc[value] = (acc[value] ?? 0) + (weights?.[index] ?? 1);
      return acc;
    }, {});
  const funnel = offerFunnelRows(group);
  const count = (key: string, value = "yes") => funnel.filter((row) => row[key] === value).length;
  return {
    stateTimeline: byTime(group.estimates, (e) => e.estimatedAt).map((e) => ({
      scenarioOrder: e.scenarioOrder,
      at: e.estimatedAt,
      stage: e.stage,
      state: e.state,
      confidence: e.confidence,
      repeatCount: e.repeatCount,
      uncertaintyReasons: e.uncertaintyReasons,
    })),
    states: tally(
      group.estimates.map((e) => e.state),
      group.estimates.map((e) => e.repeatCount)
    ),
    privateDecisions: tally(
      group.traces.map((t) => `${t.action}:${t.reasonCode}`),
      group.traces.map((t) => t.repeatCount)
    ),
    funnel: {
      memberOffers: funnel.length,
      deliveredToDevice: count("socket_delivered"),
      seen: count("seen"),
      ownAccepted: count("own_response", "accepted"),
      ownDismissed: count("own_response", "dismissed"),
      contentDelivered: count("content_delivered"),
      effectiveProxyYes: funnel.filter((row) => row.effective_proxy === "yes").length,
      humanRated: funnel.filter((row) => Number(row.human_rated_count) > 0).length,
    },
    exposureByMember: Object.entries(
      group.exposures.reduce<Record<string, Record<string, number>>>((acc, e) => {
        const member = group.studentId(e.participantId);
        acc[member] = acc[member] ?? {};
        acc[member][e.kind] = (acc[member][e.kind] ?? 0) + 1;
        return acc;
      }, {})
    ).map(([studentId, kinds]) => ({ studentId, kinds })),
    outcomes: tally(group.outcomes.map((o) => `${o.scope}:${o.difficultyResolved}:${o.validity}`)),
    fading: byTime(group.scaffolding, (s) => s.createdAt).map((s) => ({
      scenarioOrder: s.scenarioOrder,
      studentId: group.studentId(s.participantId),
      eventType: s.eventType,
      fromTier: s.fromTier,
      toTier: s.toTier,
      reasonCode: s.reasonCode,
      at: s.createdAt,
    })),
    progressFeedback: tally(group.progress.map((p) => p.response)),
    reviewLabels: group.labels.length,
  };
}
