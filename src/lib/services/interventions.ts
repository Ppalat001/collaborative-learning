import { and, asc, desc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { adaptiveEngine } from "@/lib/intervention/AdaptiveScaffoldingEngine";
import {
  CHECKPOINTS,
  discussionCoordinator,
  ROLE_CARDS,
  type CheckpointKind,
} from "@/lib/intervention/GroupDiscussionCoordinator";
import { getOnlineParticipantIds, getOnlineSince } from "@/lib/intervention/presence";
import { getPolicy, type InterventionPolicy } from "@/lib/intervention/policies";
import { GROUP_SUPPORT_LABELS, PRIVATE_OFFER_LABELS } from "@/lib/intervention/prompts";
import {
  capabilitiesFor,
  conditionOf,
  type StudyAssignment,
} from "@/lib/intervention/ResearchConditionManager";
import { consentIsActive, EligibilityError } from "@/lib/intervention/ResearchEligibilityGuard";
import {
  MANUAL_GROUP_SUPPORT_TYPES,
  type CheckpointView,
  type CollaborationSnapshot,
  type FeedbackAction,
  type InterventionStatus,
  type InterventionTrigger,
  type InterventionView,
  type SharedIdeaView,
} from "@/lib/intervention/types";
import { emitToGroup } from "@/lib/realtime/emit";
import { getScaffoldingOption, type ScaffoldingType, type Scenario } from "@/lib/types";
import { logResearchEvent } from "@/lib/utils/export";

type Session = typeof schema.sessions.$inferSelect;
type Attempt = typeof schema.scenarioAttempts.$inferSelect;
type InterventionRow = typeof schema.interventions.$inferSelect;
type FeedbackRow = typeof schema.interventionFeedback.$inferSelect;

export const SHARED_IDEA_MAX_LENGTH = 600;
const DECISION_ACTIONS: FeedbackAction[] = ["accepted", "dismissed", "deferred"];

export interface MemberInfo {
  id: string;
  name: string;
  colorIndex: number;
}

export function getMemberDirectory(sessionId: string): Map<string, MemberInfo> {
  const rows = db
    .select({ id: schema.participants.id, name: schema.participants.displayName })
    .from(schema.participants)
    .where(eq(schema.participants.sessionId, sessionId))
    .orderBy(asc(schema.participants.joinedAt))
    .all();
  return new Map(rows.map((row, index) => [row.id, { ...row, colorIndex: index }]));
}

/** Frozen roster minus withdrawn / dropped-out members. */
export function getActiveRosterIds(assignment: StudyAssignment): string[] {
  const consents = db
    .select()
    .from(schema.participantConsents)
    .where(eq(schema.participantConsents.sessionId, assignment.sessionId))
    .all();
  const active = new Set(consents.filter(consentIsActive).map((c) => c.participantId));
  return (assignment.frozenRosterIds ?? []).filter((id) => active.has(id));
}

/**
 * Reads persisted state into a monitor snapshot. Only human chat from active
 * consenting roster members is included; AI items live in their own tables.
 */
export function loadSnapshot(input: {
  session: Session;
  assignment: StudyAssignment;
  attempt: Attempt;
  now: string;
  policy?: InterventionPolicy;
}): CollaborationSnapshot {
  const { session, assignment, attempt, now } = input;
  const policy = input.policy ?? getPolicy(assignment.interventionPolicyVersion);
  const active = getActiveRosterIds(assignment);
  const activeSet = new Set(active);
  const order = attempt.scenarioOrder;

  const messages = db
    .select()
    .from(schema.discussionMessages)
    .where(
      and(eq(schema.discussionMessages.sessionId, session.id), eq(schema.discussionMessages.scenarioOrder, order))
    )
    .orderBy(asc(schema.discussionMessages.createdAt))
    .all()
    .filter((m) => m.participantId && activeSet.has(m.participantId))
    .map((m) => ({ id: m.id, participantId: m.participantId!, text: m.text, createdAt: m.createdAt }));

  const lastEdit = db
    .select({ at: schema.editEvents.createdAt, participantId: schema.editEvents.participantId })
    .from(schema.editEvents)
    .where(and(eq(schema.editEvents.sessionId, session.id), eq(schema.editEvents.scenarioOrder, order)))
    .orderBy(desc(schema.editEvents.createdAt))
    .all()
    .find((e) => e.participantId && activeSet.has(e.participantId));

  const previous = db
    .select()
    .from(schema.interventions)
    .where(eq(schema.interventions.attemptId, attempt.id))
    .orderBy(asc(schema.interventions.createdAt))
    .all();

  const optIns = db
    .select({ participantId: schema.participantAiPreferences.participantId })
    .from(schema.participantAiPreferences)
    .where(
      and(
        eq(schema.participantAiPreferences.sessionId, session.id),
        eq(schema.participantAiPreferences.privateOffersOptIn, true)
      )
    )
    .all()
    .map((p) => p.participantId)
    .filter((id) => activeSet.has(id));

  return {
    sessionId: session.id,
    scenarioAttemptId: attempt.id,
    scenarioOrder: order,
    condition: conditionOf(assignment),
    activeParticipantIds: active,
    onlineParticipantIds: getOnlineParticipantIds(session.code, order).filter((id) => activeSet.has(id)),
    startedAt: getOnlineSince(session.code, order, policy.minActiveMembersForGroupTriggers),
    lastHumanMessageAt: messages.at(-1)?.createdAt,
    lastHumanEditAt: lastEdit?.at,
    discussion: messages,
    groupAnswer: attempt.finalAnswer,
    submitted: attempt.submitted,
    previousInterventions: previous.map((p) => ({
      id: p.id,
      trigger: p.trigger as InterventionTrigger,
      scope: p.scope as "group" | "individual",
      status: p.status as InterventionStatus,
      initiatedBy: p.initiatedBy as "system" | "participant",
      recipientParticipantId: p.recipientParticipantId,
      supportType: p.supportType,
      createdAt: p.createdAt,
    })),
    privateOptInParticipantIds: optIns,
    now,
  };
}

/** Changes whenever a human message or edit is added; part of every idempotency key. */
export function activityWatermark(snapshot: CollaborationSnapshot): string {
  return `${snapshot.discussion.length}:${snapshot.discussion.at(-1)?.id ?? "-"}:${snapshot.lastHumanEditAt ?? "-"}`;
}

export function supportLabel(supportType: string): string {
  return (
    GROUP_SUPPORT_LABELS[supportType as keyof typeof GROUP_SUPPORT_LABELS] ??
    PRIVATE_OFFER_LABELS[supportType as keyof typeof PRIVATE_OFFER_LABELS] ??
    supportType
  );
}

export function toInterventionView(
  row: InterventionRow,
  names: Map<string, MemberInfo>,
  feedback: FeedbackRow[],
  deferSeconds: number
): InterventionView {
  const decisions = feedback
    .filter((f) => DECISION_ACTIONS.includes(f.action as FeedbackAction))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = decisions.at(-1);
  const deferredUntil =
    latest?.action === "deferred"
      ? new Date(Date.parse(latest.createdAt) + deferSeconds * 1000).toISOString()
      : null;
  return {
    id: row.id,
    scenarioOrder: row.scenarioOrder,
    scope: row.scope as InterventionView["scope"],
    initiatedBy: row.initiatedBy as InterventionView["initiatedBy"],
    requestedByName: row.requestedByParticipantId
      ? (names.get(row.requestedByParticipantId)?.name ?? "A member")
      : null,
    trigger: row.trigger as InterventionTrigger,
    supportType: row.supportType,
    supportLabel: supportLabel(row.supportType),
    scaffoldLevel: row.scaffoldLevel,
    status: row.status as InterventionStatus,
    offerText: row.offerText,
    content: row.status === "delivered" ? row.content : null,
    reasonExplanation: row.reasonExplanation,
    aiOrigin: row.aiOrigin,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
    failureReason: row.status === "failed" ? "The AI facilitator is unavailable right now." : null,
    myFeedback: (latest?.action as FeedbackAction | undefined) ?? null,
    deferredUntil,
  };
}

/** Marks unanswered offers past their expiry as expired; returns the rows that changed. */
export function expireStaleOffers(attemptId: string, now: string): InterventionRow[] {
  const stale = db
    .select()
    .from(schema.interventions)
    .where(
      and(
        eq(schema.interventions.attemptId, attemptId),
        inArray(schema.interventions.status, ["suggested", "deferred"]),
        isNotNull(schema.interventions.expiresAt),
        lt(schema.interventions.expiresAt, now)
      )
    )
    .all();
  const changed: InterventionRow[] = [];
  for (const row of stale) {
    const result = db
      .update(schema.interventions)
      .set({ status: "expired", resolvedAt: now })
      .where(and(eq(schema.interventions.id, row.id), inArray(schema.interventions.status, ["suggested", "deferred"])))
      .run();
    if (result.changes === 1) changed.push({ ...row, status: "expired", resolvedAt: now });
  }
  return changed;
}

/**
 * Group items plus this member's own private items. The privacy filter is part of
 * the SQL query, so another member's private offer can never be loaded here.
 */
export function listVisibleInterventions(
  attemptId: string,
  participantId: string,
  sessionId: string,
  deferSeconds: number
): InterventionView[] {
  const rows = db
    .select()
    .from(schema.interventions)
    .where(
      and(
        eq(schema.interventions.attemptId, attemptId),
        or(eq(schema.interventions.scope, "group"), eq(schema.interventions.recipientParticipantId, participantId))
      )
    )
    .orderBy(asc(schema.interventions.createdAt))
    .all();
  if (rows.length === 0) return [];
  const feedback = db
    .select()
    .from(schema.interventionFeedback)
    .where(
      and(
        eq(schema.interventionFeedback.participantId, participantId),
        inArray(
          schema.interventionFeedback.interventionId,
          rows.map((r) => r.id)
        )
      )
    )
    .all();
  const names = getMemberDirectory(sessionId);
  return rows.map((row) =>
    toInterventionView(
      row,
      names,
      feedback.filter((f) => f.interventionId === row.id),
      deferSeconds
    )
  );
}

export function listSharedIdeas(sessionId: string, scenarioOrder: number): SharedIdeaView[] {
  const names = getMemberDirectory(sessionId);
  return db
    .select()
    .from(schema.aiSharingEvents)
    .where(and(eq(schema.aiSharingEvents.sessionId, sessionId), eq(schema.aiSharingEvents.scenarioOrder, scenarioOrder)))
    .orderBy(asc(schema.aiSharingEvents.createdAt))
    .all()
    .map((row) => toSharedIdeaView(row, names));
}

function toSharedIdeaView(
  row: typeof schema.aiSharingEvents.$inferSelect,
  names: Map<string, MemberInfo>
): SharedIdeaView {
  const member = names.get(row.participantId);
  return {
    id: row.id,
    scenarioOrder: row.scenarioOrder,
    participantId: row.participantId,
    authorName: member?.name ?? "A member",
    colorIndex: member?.colorIndex ?? 0,
    sharedText: row.sharedText,
    sourceLabel:
      getScaffoldingOption(row.sourceSupportType as ScaffoldingType)?.label ?? supportLabel(row.sourceSupportType),
    createdAt: row.createdAt,
  };
}

export async function listCheckpointViews(sessionId: string, scenarioOrder: number): Promise<CheckpointView[]> {
  const names = getMemberDirectory(sessionId);
  const rows = await discussionCoordinator.listCheckpoints(sessionId, scenarioOrder);
  return rows.map((row) => ({
    id: row.id,
    scenarioOrder: row.scenarioOrder,
    kind: row.kind,
    text: CHECKPOINTS[row.kind as CheckpointKind] ?? row.kind,
    raisedByName: (row.participantId && names.get(row.participantId)?.name) || "A member",
    createdAt: row.createdAt,
  }));
}

/** Private AI help this member accepted in this scenario (popup suggestions, not Step 2). */
export function hasDeliveredPrivateHelp(participantId: string, attemptId: string): boolean {
  return Boolean(
    db
      .select({ id: schema.interventions.id })
      .from(schema.interventions)
      .where(
        and(
          eq(schema.interventions.attemptId, attemptId),
          eq(schema.interventions.recipientParticipantId, participantId),
          eq(schema.interventions.status, "delivered")
        )
      )
      .get()
  );
}

export function getPrivateOptIn(participantId: string): boolean {
  const row = db
    .select()
    .from(schema.participantAiPreferences)
    .where(eq(schema.participantAiPreferences.participantId, participantId))
    .get();
  return row?.privateOffersOptIn ?? false;
}

export async function setPrivateOptIn(assignment: StudyAssignment, participantId: string, optIn: boolean) {
  if (!capabilitiesFor(conditionOf(assignment)).proactivePrivate) {
    throw new EligibilityError("Private suggestions are not part of this study condition", "not_in_condition", 403);
  }
  const now = new Date().toISOString();
  await db
    .insert(schema.participantAiPreferences)
    .values({ sessionId: assignment.sessionId, participantId, privateOffersOptIn: optIn, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.participantAiPreferences.participantId,
      set: { privateOffersOptIn: optIn, updatedAt: now },
    });
  await logResearchEvent(assignment.sessionId, optIn ? "private_offers_opt_in" : "private_offers_opt_out", {}, participantId);
  return optIn;
}

/**
 * Explicit, confirmed sharing of a private AI idea. The text the member chose is
 * stored; this does not mean anyone read or used it.
 */
export async function shareIdeaWithGroup(input: {
  assignment: StudyAssignment;
  session: Session;
  participantId: string;
  scenarioOrder: number;
  sourceType: "individual_scaffold" | "intervention";
  /** Intervention id, or for individual_scaffold the private support type. */
  sourceId: string;
  sharedText: string;
}) {
  if (!capabilitiesFor(conditionOf(input.assignment)).sharing) {
    throw new EligibilityError("Sharing AI ideas is not part of this study condition", "not_in_condition", 403);
  }
  const text = input.sharedText.trim();
  if (!text) throw new EligibilityError("Choose what to share first", "empty", 400);
  if (text.length > SHARED_IDEA_MAX_LENGTH) {
    throw new EligibilityError(`Keep the shared idea under ${SHARED_IDEA_MAX_LENGTH} characters`, "too_long", 400);
  }
  const attempt = db
    .select()
    .from(schema.scenarioAttempts)
    .where(
      and(
        eq(schema.scenarioAttempts.sessionId, input.session.id),
        eq(schema.scenarioAttempts.scenarioOrder, input.scenarioOrder)
      )
    )
    .get();
  if (!attempt || attempt.submitted) {
    throw new EligibilityError("This scenario is finished", "scenario_submitted", 409);
  }

  let sourceSupportType: string;
  let sourceId = input.sourceId;
  if (input.sourceType === "individual_scaffold") {
    if (input.sourceId === "full_answer") {
      throw new EligibilityError(
        "A full expert answer can't be shared with this button. Put the idea in your own words in the chat instead.",
        "full_answer_not_shareable",
        400
      );
    }
    const source = db
      .select()
      .from(schema.individualScaffolds)
      .where(
        and(
          eq(schema.individualScaffolds.scaffoldingType, input.sourceId),
          eq(schema.individualScaffolds.participantId, input.participantId),
          eq(schema.individualScaffolds.scenarioOrder, input.scenarioOrder)
        )
      )
      .get();
    if (!source) throw new EligibilityError("That AI response is not yours to share", "not_found", 404);
    sourceSupportType = source.scaffoldingType;
    sourceId = source.id;
  } else {
    const source = db
      .select()
      .from(schema.interventions)
      .where(
        and(
          eq(schema.interventions.id, input.sourceId),
          eq(schema.interventions.recipientParticipantId, input.participantId),
          eq(schema.interventions.status, "delivered")
        )
      )
      .get();
    if (!source) throw new EligibilityError("That AI response is not yours to share", "not_found", 404);
    sourceSupportType = source.supportType;
  }

  const [row] = await db
    .insert(schema.aiSharingEvents)
    .values({
      sessionId: input.session.id,
      participantId: input.participantId,
      scenarioOrder: input.scenarioOrder,
      sourceType: input.sourceType,
      sourceId,
      sourceSupportType,
      sharedText: text,
    })
    .returning();
  if (input.sourceType === "intervention") {
    await db.insert(schema.interventionFeedback).values({
      sessionId: input.session.id,
      interventionId: input.sourceId,
      participantId: input.participantId,
      action: "shared",
    });
  }
  const view = toSharedIdeaView(row, getMemberDirectory(input.session.id));
  emitToGroup(input.session.code, input.scenarioOrder, "ideas:shared", view);
  return view;
}

/** V2 private-support precondition: the member's own first idea, when the group requires one. */
export async function checkV2PrivateSupportGate(
  assignment: StudyAssignment,
  participantId: string,
  scenarioOrder: number
): Promise<{ status: number; code: string; error: string } | null> {
  if (assignment.features.initialIdea === "required") {
    const idea = await discussionCoordinator.getInitialIdea(participantId, scenarioOrder);
    if (!idea) {
      return {
        status: 409,
        code: "initial_idea_required",
        error: "Write down your own first idea before using AI support.",
      };
    }
  }
  return null;
}

/** Everything the scenario page needs for V2 features, filtered for the calling member. */
export async function getScenarioV2State(input: {
  session: Session;
  assignment: StudyAssignment;
  attempt: Attempt;
  scenario: Scenario;
  participantId: string | null;
  members: { id: string; name: string }[];
}) {
  const { session, assignment, attempt, scenario, participantId } = input;
  const policy = getPolicy(assignment.interventionPolicyVersion);
  const capabilities = capabilitiesFor(conditionOf(assignment));
  const features = assignment.features;
  const roster = assignment.frozenRosterIds ?? [];
  const now = new Date().toISOString();
  expireStaleOffers(attempt.id, now);

  const roles = features.roles
    ? {
        cards: ROLE_CARDS,
        suggested: discussionCoordinator.offerRoles(roster, scenario.order),
        chosen: (await discussionCoordinator.listRoles(session.id, scenario.order)).map((r) => ({
          participantId: r.participantId,
          role: r.role,
        })),
      }
    : null;

  const initialIdea = participantId ? await discussionCoordinator.getInitialIdea(participantId, scenario.order) : null;

  let recommendation = null;
  if (participantId && capabilities.fading && !attempt.submitted) {
    const { recommendation: rec } = adaptiveEngine.ensureRecommendation({
      sessionId: session.id,
      participantId,
      scenarioOrder: scenario.order,
      lookback: policy.fadingLookbackScenarios,
    });
    recommendation = {
      level: rec.level,
      supportType: rec.supportType,
      label: getScaffoldingOption(rec.supportType as ScaffoldingType)?.label ?? rec.supportType,
      fadingApplied: rec.fadingApplied,
      rationale: rec.rationale,
    };
  }

  return {
    openingPrompt: features.openingPrompt ? discussionCoordinator.getOpeningPrompt(scenario, input.members) : null,
    roles,
    initialIdea: {
      mode: features.initialIdea,
      submitted: Boolean(initialIdea),
      text: initialIdea?.text ?? null,
    },
    agreementReasonMode: features.agreementReason,
    checkpoints: features.checkpoints
      ? {
          kinds: Object.entries(CHECKPOINTS).map(([kind, text]) => ({ kind, text })),
          raised: await listCheckpointViews(session.id, scenario.order),
        }
      : null,
    interventions: participantId
      ? listVisibleInterventions(attempt.id, participantId, session.id, policy.deferSeconds)
      : [],
    sharedIdeas: capabilities.sharing ? listSharedIdeas(session.id, scenario.order) : [],
    manualGroupSupport: capabilities.sharedManual
      ? MANUAL_GROUP_SUPPORT_TYPES.map((type) => ({ type, label: GROUP_SUPPORT_LABELS[type] }))
      : [],
    privateOptIn: capabilities.proactivePrivate && participantId ? getPrivateOptIn(participantId) : null,
    recommendation,
  };
}

export type ScenarioV2State = Awaited<ReturnType<typeof getScenarioV2State>>;
