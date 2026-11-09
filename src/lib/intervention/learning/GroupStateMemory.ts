import { createHash } from "crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { groupStateEstimator } from "../GroupStateEstimator";
import type { InterventionPolicy } from "../policies";
import type { CollaborationSnapshot, EstimatedGroupState, InterventionTrigger } from "../types";

/**
 * Short-term memory of one group's scenario, read from the research tables (no
 * separate in-memory store): the evidence the estimator may use, the estimates
 * already logged, and how earlier proactive group prompts turned out.
 */

type EstimateRow = typeof schema.groupStateEstimates.$inferSelect;

export function estimateSignature(estimate: EstimatedGroupState): string {
  const key = [
    estimate.stage,
    estimate.state,
    estimate.confidence.toFixed(2),
    estimate.evidence.map((r) => `${r.kind}:${r.id}`).join(","),
    estimate.counterEvidence.map((r) => `${r.kind}:${r.id}`).join(","),
    estimate.uncertaintyReasons.join(","),
    estimate.stateReasons.join(","),
    estimate.classifierNote ?? "",
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

export class GroupStateMemory {
  /** Public, human-produced evidence only: answer edits and checkpoints of this scenario. */
  evidence(sessionId: string, scenarioOrder: number) {
    const edits = db
      .select()
      .from(schema.editEvents)
      .where(
        and(
          eq(schema.editEvents.sessionId, sessionId),
          eq(schema.editEvents.scenarioOrder, scenarioOrder),
          eq(schema.editEvents.field, "finalAnswer")
        )
      )
      .all()
      .map((e) => ({ id: e.id, at: e.createdAt, charsAdded: e.charsAdded, charsRemoved: e.charsRemoved }));
    const checkpoints = db
      .select()
      .from(schema.groupCheckpoints)
      .where(and(eq(schema.groupCheckpoints.sessionId, sessionId), eq(schema.groupCheckpoints.scenarioOrder, scenarioOrder)))
      .all()
      .map((c) => ({ id: c.id, kind: c.kind, at: c.createdAt }));
    return { edits, checkpoints };
  }

  estimate(groupCode: string, snapshot: CollaborationSnapshot, policy: InterventionPolicy): EstimatedGroupState {
    const { edits, checkpoints } = this.evidence(snapshot.sessionId, snapshot.scenarioOrder);
    return groupStateEstimator.estimate({ groupCode, snapshot, edits, checkpoints, policy });
  }

  /** Logs the estimate behind an evaluation; an unchanged repeat only bumps repeat_count. */
  record(input: {
    sessionId: string;
    attemptId: string;
    scenarioOrder: number;
    evaluationId: string | null;
    policyVersion: string;
    estimate: EstimatedGroupState;
    now: string;
  }): { id: string; collapsed: boolean } {
    const signature = estimateSignature(input.estimate);
    return db.transaction((tx) => {
      const latest = tx
        .select()
        .from(schema.groupStateEstimates)
        .where(eq(schema.groupStateEstimates.attemptId, input.attemptId))
        .orderBy(desc(schema.groupStateEstimates.estimatedAt))
        .limit(1)
        .get();
      if (latest && latest.contextSignature === signature && latest.evaluationId === input.evaluationId) {
        tx.update(schema.groupStateEstimates)
          .set({ repeatCount: latest.repeatCount + 1, lastRepeatedAt: input.now })
          .where(eq(schema.groupStateEstimates.id, latest.id))
          .run();
        return { id: latest.id, collapsed: true };
      }
      const { estimate } = input;
      const row = tx
        .insert(schema.groupStateEstimates)
        .values({
          sessionId: input.sessionId,
          attemptId: input.attemptId,
          scenarioOrder: input.scenarioOrder,
          evaluationId: input.evaluationId,
          policyVersion: input.policyVersion,
          estimatorVersion: estimate.estimatorVersion,
          stage: estimate.stage,
          state: estimate.state,
          confidence: estimate.confidence,
          evidence: estimate.evidence,
          counterEvidence: estimate.counterEvidence,
          uncertaintyReasons: estimate.uncertaintyReasons,
          stateReasons: estimate.stateReasons,
          classifierModel: estimate.classifierModel ?? null,
          classifierNote: estimate.classifierNote ?? null,
          contextSignature: signature,
          estimatedAt: input.now,
        })
        .returning({ id: schema.groupStateEstimates.id })
        .get();
      return { id: row.id, collapsed: false };
    });
  }

  latest(attemptId: string): EstimateRow | null {
    return (
      db
        .select()
        .from(schema.groupStateEstimates)
        .where(eq(schema.groupStateEstimates.attemptId, attemptId))
        .orderBy(desc(schema.groupStateEstimates.estimatedAt))
        .limit(1)
        .get() ?? null
    );
  }

  /** Delivery time of the latest proactive group prompt in this attempt. */
  lastGroupDeliveredAt(attemptId: string): string | null {
    return (
      db
        .select({ deliveredAt: schema.interventions.deliveredAt })
        .from(schema.interventions)
        .where(
          and(
            eq(schema.interventions.attemptId, attemptId),
            eq(schema.interventions.scope, "group"),
            eq(schema.interventions.initiatedBy, "system"),
            isNotNull(schema.interventions.deliveredAt)
          )
        )
        .orderBy(desc(schema.interventions.deliveredAt))
        .limit(1)
        .get()?.deliveredAt ?? null
    );
  }

  /**
   * Triggers whose earlier group prompt in this scenario was followed by the
   * same obstacle (usable evidence): the same prompt is not offered again.
   */
  ineffectiveTriggers(attemptId: string): InterventionTrigger[] {
    const rows = db
      .select({
        trigger: schema.interventions.trigger,
        resolved: schema.interventionOutcomeEvaluations.difficultyResolved,
        validity: schema.interventionOutcomeEvaluations.validity,
      })
      .from(schema.interventionOutcomeEvaluations)
      .innerJoin(schema.interventions, eq(schema.interventions.id, schema.interventionOutcomeEvaluations.interventionId))
      .where(
        and(eq(schema.interventions.attemptId, attemptId), eq(schema.interventionOutcomeEvaluations.subjectKey, "group"))
      )
      .all();
    return [
      ...new Set(
        rows.filter((r) => r.resolved === "no" && r.validity === "usable").map((r) => r.trigger as InterventionTrigger)
      ),
    ];
  }
}

export const groupStateMemory = new GroupStateMemory();
