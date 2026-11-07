import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { GeneratedSupport } from "@/lib/ai/GroupAIFacilitator";
import type {
  FeedbackAction,
  InterventionAssessment,
  InterventionDecision,
  InterventionStatus,
} from "./types";

/**
 * The single writer for V2 decision and intervention records. Every evaluation is
 * logged, including decisions not to intervene; an unchanged repeated no-action
 * evaluation increments `repeat_count` on the previous row instead of adding rows.
 */

export type InterventionRow = typeof schema.interventions.$inferSelect;
export type EvaluationSource = "human_activity" | "scheduler" | "manual_request" | "personal_request";

export interface DecisionLogInput {
  sessionId: string;
  attemptId: string;
  scenarioOrder: number;
  source: EvaluationSource;
  decision: InterventionDecision;
  assessments: InterventionAssessment[];
  watermark: string;
  onlineCount: number;
  activeMemberCount: number;
  classifierModel?: string | null;
  classifierNote?: string | null;
  shadowOnly: boolean;
  now: string;
}

function signature(input: DecisionLogInput): string {
  const d = input.decision;
  const automatic = input.source === "scheduler" || input.source === "human_activity";
  return [
    automatic ? "auto" : input.source,
    d.action,
    d.trigger,
    d.reasonCode,
    d.scope ?? "-",
    d.targetParticipantId ?? "-",
    input.watermark,
  ].join("|");
}

export class InterventionResearchLogger {
  /** Stores the monitor's assessments together with the decision (one row per evaluation). */
  logDecision(input: DecisionLogInput): { evaluationId: string; collapsed: boolean } {
    const sig = signature(input);
    return db.transaction((tx) => {
      const state = tx
        .select()
        .from(schema.interventionState)
        .where(eq(schema.interventionState.attemptId, input.attemptId))
        .get();

      if (
        state?.lastEvaluationId &&
        state.lastEvaluationSignature === sig &&
        input.decision.action === "no_action"
      ) {
        tx.update(schema.interventionEvaluations)
          .set({
            repeatCount: sql`${schema.interventionEvaluations.repeatCount} + 1`,
            lastRepeatedAt: input.now,
          })
          .where(eq(schema.interventionEvaluations.id, state.lastEvaluationId))
          .run();
        tx.update(schema.interventionState)
          .set({ lastEvaluatedAt: input.now, updatedAt: input.now })
          .where(eq(schema.interventionState.id, state.id))
          .run();
        return { evaluationId: state.lastEvaluationId, collapsed: true };
      }

      const d = input.decision;
      const top = d.assessment;
      const summary = [top?.evidenceSummary, input.classifierNote].filter(Boolean).join(" | ") || null;
      const row = tx
        .insert(schema.interventionEvaluations)
        .values({
          sessionId: input.sessionId,
          attemptId: input.attemptId,
          scenarioOrder: input.scenarioOrder,
          evaluationSource: input.source,
          researchCondition: d.condition,
          policyVersion: d.policyVersion,
          trigger: d.trigger,
          assessmentSource: top?.source ?? null,
          evidenceMessageIds: top?.evidenceMessageIds ?? [],
          evidenceSummary: summary,
          confidence: top?.confidence ?? null,
          progressState: top?.progressState ?? input.assessments[0]?.progressState ?? null,
          assessments: input.assessments,
          decisionAction: d.action,
          decisionScope: d.scope ?? null,
          targetParticipantId: d.targetParticipantId ?? null,
          supportType: d.supportType ?? null,
          recommendedLevel: d.recommendedLevel === undefined ? null : String(d.recommendedLevel),
          reasonCode: d.reasonCode,
          reasonExplanation: d.reasonExplanation,
          activityWatermark: input.watermark,
          onlineCount: input.onlineCount,
          activeMemberCount: input.activeMemberCount,
          classifierModel: input.classifierModel ?? null,
          shadowOnly: input.shadowOnly,
          evaluatedAt: input.now,
        })
        .returning({ id: schema.interventionEvaluations.id })
        .get();

      if (state) {
        tx.update(schema.interventionState)
          .set({
            lastEvaluatedAt: input.now,
            lastEvaluationId: row.id,
            lastEvaluationSignature: sig,
            updatedAt: input.now,
          })
          .where(eq(schema.interventionState.id, state.id))
          .run();
      } else {
        tx.insert(schema.interventionState)
          .values({
            sessionId: input.sessionId,
            attemptId: input.attemptId,
            lastEvaluatedAt: input.now,
            lastEvaluationId: row.id,
            lastEvaluationSignature: sig,
            updatedAt: input.now,
          })
          .onConflictDoNothing()
          .run();
      }
      return { evaluationId: row.id, collapsed: false };
    });
  }

  /**
   * Inserts an offer or manual request once per idempotency key. Proactive offers
   * also bump the per-scenario counters and cooldown in the same transaction.
   */
  logOffer(
    values: typeof schema.interventions.$inferInsert,
    options: { proactive: boolean; now: string }
  ): { row: InterventionRow; created: boolean } {
    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(schema.interventions)
        .where(eq(schema.interventions.idempotencyKey, values.idempotencyKey))
        .get();
      if (existing) return { row: existing, created: false };
      const row = tx.insert(schema.interventions).values(values).returning().get();
      if (options.proactive) {
        const isGroup = values.scope === "group";
        const state = tx
          .select()
          .from(schema.interventionState)
          .where(eq(schema.interventionState.attemptId, values.attemptId))
          .get();
        if (state) {
          tx.update(schema.interventionState)
            .set({
              lastProactiveAt: isGroup ? options.now : state.lastProactiveAt,
              proactiveGroupCount: state.proactiveGroupCount + (isGroup ? 1 : 0),
              proactivePrivateCount: state.proactivePrivateCount + (isGroup ? 0 : 1),
              updatedAt: options.now,
            })
            .where(eq(schema.interventionState.id, state.id))
            .run();
        } else {
          tx.insert(schema.interventionState)
            .values({
              sessionId: values.sessionId,
              attemptId: values.attemptId,
              lastProactiveAt: isGroup ? options.now : null,
              proactiveGroupCount: isGroup ? 1 : 0,
              proactivePrivateCount: isGroup ? 0 : 1,
              updatedAt: options.now,
            })
            .run();
        }
      }
      return { row, created: true };
    });
  }

  /** Conditional status change; returns the updated row only if this call made the transition. */
  transition(
    id: string,
    from: InterventionStatus[],
    patch: Partial<typeof schema.interventions.$inferInsert>
  ): InterventionRow | null {
    const result = db
      .update(schema.interventions)
      .set(patch)
      .where(and(eq(schema.interventions.id, id), inArray(schema.interventions.status, from)))
      .run();
    if (result.changes !== 1) return null;
    return db.select().from(schema.interventions).where(eq(schema.interventions.id, id)).get() ?? null;
  }

  logDelivery(id: string, generated: GeneratedSupport, now: string): InterventionRow | null {
    return this.transition(id, ["accepted"], {
      status: "delivered",
      content: generated.content,
      aiOrigin: generated.aiOrigin,
      aiModel: generated.aiModel,
      promptVersion: generated.promptVersion,
      aiLatencyMs: generated.latencyMs,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      failureReason: generated.note,
      deliveredAt: now,
      resolvedAt: now,
    });
  }

  logFailure(id: string, reason: string, now: string, aiModel?: string | null): InterventionRow | null {
    return this.transition(id, ["accepted"], {
      status: "failed",
      failureReason: reason.slice(0, 300),
      aiModel: aiModel ?? null,
      resolvedAt: now,
    });
  }

  logFeedback(input: {
    sessionId: string;
    interventionId: string;
    participantId: string;
    action: FeedbackAction;
    comment?: string | null;
    now: string;
  }) {
    return db
      .insert(schema.interventionFeedback)
      .values({
        sessionId: input.sessionId,
        interventionId: input.interventionId,
        participantId: input.participantId,
        action: input.action,
        comment: input.comment ?? null,
        createdAt: input.now,
      })
      .returning()
      .get();
  }
}

export const researchLogger = new InterventionResearchLogger();
