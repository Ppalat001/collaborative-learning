import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { AdaptivePrivatePolicy } from "../policies";
import type { AdaptiveDecision } from "./AdaptivePrivatePolicy";
import { initialState, type LearnerState } from "./LearnerModel";
import { applySignal, contributionGaps, type LearnerSignal } from "./rewards";

/**
 * Persistence for the per-member learner models. Every change is one synchronous
 * SQLite transaction that checks the event key, updates the model and logs the
 * state before and after, so an update can never be applied twice.
 */

type LearnerRow = typeof schema.learnerModels.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ModelRef {
  sessionId: string;
  participantId: string;
  policyVersion: string;
  policy: AdaptivePrivatePolicy;
  now: string;
}

export class LearnerModelStore {
  private pretestFraction(tx: Tx, participantId: string): number | null {
    const pre = tx
      .select({ score: schema.assessments.score, maxScore: schema.assessments.maxScore })
      .from(schema.assessments)
      .where(and(eq(schema.assessments.participantId, participantId), eq(schema.assessments.assessmentType, "pre")))
      .orderBy(desc(schema.assessments.completedAt))
      .get();
    return pre && pre.maxScore > 0 ? pre.score / pre.maxScore : null;
  }

  private loadIn(tx: Tx, ref: ModelRef): LearnerRow {
    const existing = tx
      .select()
      .from(schema.learnerModels)
      .where(eq(schema.learnerModels.participantId, ref.participantId))
      .get();
    if (existing) return existing;
    const pretestFraction = this.pretestFraction(tx, ref.participantId);
    const state = initialState(ref.policy, pretestFraction);
    const row = tx
      .insert(schema.learnerModels)
      .values({
        sessionId: ref.sessionId,
        participantId: ref.participantId,
        modelVersion: ref.policy.modelVersion,
        policyVersion: ref.policyVersion,
        pretestFraction,
        state,
        createdAt: ref.now,
        updatedAt: ref.now,
      })
      .returning()
      .get();
    tx.insert(schema.learnerModelEvents)
      .values({
        sessionId: ref.sessionId,
        participantId: ref.participantId,
        eventType: "model_created",
        eventKey: "created",
        weight: 0,
        detail: { pretestFraction, modelVersion: ref.policy.modelVersion, priors: ref.policy.priors },
        stateBefore: null,
        stateAfter: state,
        createdAt: ref.now,
      })
      .run();
    return row;
  }

  /** The member's model, created from the priors and their own pre-test on first use. */
  load(ref: ModelRef): LearnerRow {
    return db.transaction((tx) => this.loadIn(tx, ref));
  }

  get(participantId: string): LearnerRow | null {
    return db.select().from(schema.learnerModels).where(eq(schema.learnerModels.participantId, participantId)).get() ?? null;
  }

  /** Event keys of the offer responses and help outcomes already applied for this member. */
  offerEventKeys(participantId: string): Set<string> {
    return new Set(
      db
        .select({ key: schema.learnerModelEvents.eventKey })
        .from(schema.learnerModelEvents)
        .where(
          and(
            eq(schema.learnerModelEvents.participantId, participantId),
            inArray(schema.learnerModelEvents.eventType, ["offer_response", "help_outcome"])
          )
        )
        .all()
        .map((row) => row.key)
    );
  }

  /**
   * Applies one signal at most once per event key and logs it. Signals that leave
   * the posteriors unchanged are still logged, so the audit shows they were assessed.
   */
  apply(
    ref: ModelRef & {
      scenarioOrder: number | null;
      eventKey: string;
      signal: LearnerSignal | null;
      interventionId?: string | null;
      detail?: Record<string, unknown>;
    }
  ): { applied: boolean; state: LearnerState } {
    return db.transaction((tx) => {
      const row = this.loadIn(tx, ref);
      const seen = tx
        .select({ id: schema.learnerModelEvents.id })
        .from(schema.learnerModelEvents)
        .where(
          and(
            eq(schema.learnerModelEvents.participantId, ref.participantId),
            eq(schema.learnerModelEvents.eventKey, ref.eventKey)
          )
        )
        .get();
      if (seen) return { applied: false, state: row.state };
      const result = ref.signal
        ? applySignal(row.state, ref.signal, ref.policy)
        : { state: row.state, changed: false, reward: null, weight: 0 };
      if (result.changed) {
        tx.update(schema.learnerModels)
          .set({ state: result.state, updatedAt: ref.now })
          .where(eq(schema.learnerModels.id, row.id))
          .run();
      }
      tx.insert(schema.learnerModelEvents)
        .values({
          sessionId: ref.sessionId,
          participantId: ref.participantId,
          scenarioOrder: ref.scenarioOrder,
          eventType: ref.signal?.kind ?? String(ref.detail?.eventType ?? "note"),
          eventKey: ref.eventKey,
          interventionId: ref.interventionId ?? null,
          reward: result.reward,
          weight: result.weight,
          detail: { ...(ref.signal ?? {}), ...(ref.detail ?? {}) },
          stateBefore: row.state,
          stateAfter: result.state,
          createdAt: ref.now,
        })
        .run();
      return { applied: true, state: result.state };
    });
  }

  /**
   * Folds the member's new contributions in one scenario into the pace estimate
   * and moves the cursor past them. Returns the current state.
   */
  observeContributions(ref: ModelRef & { scenarioOrder: number; times: string[] }): LearnerState {
    return db.transaction((tx) => {
      const row = this.loadIn(tx, ref);
      const cursor = row.state.paceCursor;
      const previous = cursor && cursor.scenarioOrder === ref.scenarioOrder ? cursor.at : null;
      const fresh = ref.times.filter((at) => !previous || at > previous);
      if (fresh.length === 0) return row.state;
      const { gaps, last } = contributionGaps(fresh, previous, ref.policy.burstMergeSeconds);
      const result = applySignal(row.state, { kind: "pace_gaps", gaps }, ref.policy);
      const state: LearnerState = {
        ...result.state,
        paceCursor: last ? { scenarioOrder: ref.scenarioOrder, at: last } : row.state.paceCursor,
      };
      tx.update(schema.learnerModels)
        .set({ state, updatedAt: ref.now })
        .where(eq(schema.learnerModels.id, row.id))
        .run();
      if (result.changed) {
        tx.insert(schema.learnerModelEvents)
          .values({
            sessionId: ref.sessionId,
            participantId: ref.participantId,
            scenarioOrder: ref.scenarioOrder,
            eventType: "pace_gaps",
            eventKey: `pace:${ref.scenarioOrder}:${last}`,
            weight: result.weight,
            detail: { gaps: gaps.map((gap) => Math.round(gap)) },
            stateBefore: row.state,
            stateAfter: state,
            createdAt: ref.now,
          })
          .onConflictDoNothing()
          .run();
      }
      return state;
    });
  }

  /** Stores an offer decision next to the other scaffold recommendations. */
  logDecision(input: {
    sessionId: string;
    participantId: string;
    scenarioOrder: number;
    interventionId: string;
    decision: Extract<AdaptiveDecision, { action: "offer" }>;
    now: string;
  }) {
    const { decision } = input;
    return db
      .insert(schema.scaffoldRecommendations)
      .values({
        sessionId: input.sessionId,
        participantId: input.participantId,
        scenarioOrder: input.scenarioOrder,
        interventionId: input.interventionId,
        engineVersion: decision.evidence.modelVersion,
        recommendedLevel: decision.level,
        recommendedSupportType: decision.arm,
        // Fading is continuous in this model (through the independence posterior), not a switch.
        fadingApplied: false,
        evidence: { ...decision.evidence },
        rationale: decision.rationale,
        createdAt: input.now,
      })
      .returning()
      .get();
  }

  decisionFor(interventionId: string) {
    return (
      db
        .select()
        .from(schema.scaffoldRecommendations)
        .where(eq(schema.scaffoldRecommendations.interventionId, interventionId))
        .get() ?? null
    );
  }

  /** Closes the decision of an offer the member did not take. */
  resolveDeclined(interventionId: string, now: string) {
    db.update(schema.scaffoldRecommendations)
      .set({ resolvedAt: now })
      .where(
        and(
          eq(schema.scaffoldRecommendations.interventionId, interventionId),
          isNull(schema.scaffoldRecommendations.resolvedAt)
        )
      )
      .run();
  }
}

export const learnerStore = new LearnerModelStore();
