import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getScaffoldingOption, type ScaffoldingType } from "@/lib/types";
import { isConfusion } from "./CollaborationMonitor";
import type { PrivateRecommendation } from "./InterventionDecisionEngine";

/**
 * Least-intrusive-first recommendations for private help (dual_adaptive only).
 *
 * - Start at level 1 (minimal). Escalate to level 2 only when this member already
 *   received minimal help in this scenario and then said they were still unsure
 *   or asked again. Never recommend level 3 (full answer).
 * - Fading: when the member contributed on their own before any AI use in each of
 *   the last N scenarios and never needed more than minimal help, level-1 help is
 *   offered as a guiding question (asks) instead of a hint (tells).
 *
 * These are observations about how support was used, not measures of proficiency;
 * message counts are never used. The member can always choose any option.
 */

export const ENGINE_VERSION = "adaptive-v1";

export interface ScenarioObservation {
  scenarioOrder: number;
  /** Wrote a message or typed in the answer before their first AI use in that scenario. */
  contributedBeforeAi: boolean;
  usedAi: boolean;
  /** Highest content level (1-3) of private AI used; null when none or process-only. */
  maxContentLevel: number | null;
  submitted: boolean;
}

export interface CurrentScenarioState {
  minimalSupportReceived: boolean;
  confusionAfterMinimal: boolean;
  explicitlyRequestedMore: boolean;
}

export interface ParticipantHistory {
  scenarioOrder: number;
  /** Earlier scenarios, oldest first. */
  previous: ScenarioObservation[];
  current: CurrentScenarioState;
}

export interface Recommendation extends PrivateRecommendation {
  evidence: Record<string, unknown>;
}

const MINIMAL_TYPES: ScaffoldingType[] = ["hint", "guiding_question"];

function contentLevel(type: string): number | null {
  const option = getScaffoldingOption(type as ScaffoldingType);
  return option?.category === "content" ? (option.supportLevel ?? null) : null;
}

export class AdaptiveScaffoldingEngine {
  shouldFade(history: ParticipantHistory, lookback: number): boolean {
    if (lookback <= 0) return false;
    const recent = history.previous.slice(-lookback);
    return (
      recent.length === lookback &&
      recent.every((s) => s.submitted && s.contributedBeforeAi && (s.maxContentLevel ?? 0) <= 1)
    );
  }

  recommendLevel(history: ParticipantHistory, lookback: number): Recommendation {
    const fade = this.shouldFade(history, lookback);
    const { current } = history;
    const evidence = {
      scenarioOrder: history.scenarioOrder,
      lookbackScenarios: lookback,
      previous: history.previous.slice(-lookback),
      current,
    };
    if (current.minimalSupportReceived && (current.confusionAfterMinimal || current.explicitlyRequestedMore)) {
      return {
        level: 2,
        supportType: "explanation",
        fadingApplied: false,
        rationale: current.explicitlyRequestedMore
          ? "Minimal help was already given in this scenario and the member asked for more."
          : "Minimal help was already given in this scenario and the member said they were still unsure.",
        evidence,
      };
    }
    if (fade) {
      return {
        level: 1,
        supportType: "guiding_question",
        fadingApplied: true,
        rationale: `In each of the last ${lookback} scenarios the member contributed before using AI and needed at most minimal help, so help is faded to a guiding question.`,
        evidence,
      };
    }
    return {
      level: 1,
      supportType: "hint",
      fadingApplied: false,
      rationale: "Start with the least intrusive help.",
      evidence,
    };
  }

  /** Reads what this member did in earlier scenarios and in the current one. */
  buildHistory(sessionId: string, participantId: string, scenarioOrder: number, lookback: number): ParticipantHistory {
    const firstOrder = Math.max(1, scenarioOrder - Math.max(lookback, 1));
    const previous: ScenarioObservation[] = [];
    for (let order = firstOrder; order < scenarioOrder; order++) {
      previous.push(this.observeScenario(sessionId, participantId, order));
    }
    return { scenarioOrder, previous, current: this.observeCurrent(sessionId, participantId, scenarioOrder) };
  }

  private privateSupportEvents(sessionId: string, participantId: string, scenarioOrder: number) {
    const scaffolds = db
      .select({ type: schema.individualScaffolds.scaffoldingType, at: schema.individualScaffolds.createdAt })
      .from(schema.individualScaffolds)
      .where(
        and(
          eq(schema.individualScaffolds.participantId, participantId),
          eq(schema.individualScaffolds.scenarioOrder, scenarioOrder)
        )
      )
      .all();
    const offers = db
      .select({
        type: schema.interventions.supportType,
        level: schema.interventions.scaffoldLevel,
        at: schema.interventions.deliveredAt,
      })
      .from(schema.interventions)
      .where(
        and(
          eq(schema.interventions.sessionId, sessionId),
          eq(schema.interventions.recipientParticipantId, participantId),
          eq(schema.interventions.scenarioOrder, scenarioOrder),
          eq(schema.interventions.status, "delivered")
        )
      )
      .all();
    return [
      ...scaffolds.map((s) => ({ at: s.at, level: contentLevel(s.type), minimal: MINIMAL_TYPES.includes(s.type as ScaffoldingType) })),
      ...offers
        .filter((o) => o.at)
        .map((o) => ({ at: o.at!, level: Number(o.level) || null, minimal: o.level === "1" })),
    ].sort((a, b) => a.at.localeCompare(b.at));
  }

  private observeScenario(sessionId: string, participantId: string, scenarioOrder: number): ScenarioObservation {
    const events = this.privateSupportEvents(sessionId, participantId, scenarioOrder);
    const firstAiAt = events[0]?.at ?? null;
    const attempt = db
      .select({ submitted: schema.scenarioAttempts.submitted })
      .from(schema.scenarioAttempts)
      .where(
        and(
          eq(schema.scenarioAttempts.sessionId, sessionId),
          eq(schema.scenarioAttempts.scenarioOrder, scenarioOrder)
        )
      )
      .get();
    const before = (column: typeof schema.discussionMessages.createdAt | typeof schema.editEvents.createdAt) =>
      firstAiAt ? lt(column, firstAiAt) : undefined;
    const message = db
      .select({ id: schema.discussionMessages.id })
      .from(schema.discussionMessages)
      .where(
        and(
          eq(schema.discussionMessages.sessionId, sessionId),
          eq(schema.discussionMessages.participantId, participantId),
          eq(schema.discussionMessages.scenarioOrder, scenarioOrder),
          before(schema.discussionMessages.createdAt)
        )
      )
      .limit(1)
      .get();
    const edit = db
      .select({ id: schema.editEvents.id })
      .from(schema.editEvents)
      .where(
        and(
          eq(schema.editEvents.sessionId, sessionId),
          eq(schema.editEvents.participantId, participantId),
          eq(schema.editEvents.scenarioOrder, scenarioOrder),
          before(schema.editEvents.createdAt)
        )
      )
      .limit(1)
      .get();
    const levels = events.map((e) => e.level).filter((l): l is number => l !== null);
    return {
      scenarioOrder,
      contributedBeforeAi: Boolean(message || edit),
      usedAi: events.length > 0,
      maxContentLevel: levels.length ? Math.max(...levels) : null,
      submitted: Boolean(attempt?.submitted),
    };
  }

  private observeCurrent(sessionId: string, participantId: string, scenarioOrder: number): CurrentScenarioState {
    const events = this.privateSupportEvents(sessionId, participantId, scenarioOrder);
    const firstMinimal = events.find((e) => e.minimal)?.at ?? null;
    if (!firstMinimal) {
      return { minimalSupportReceived: false, confusionAfterMinimal: false, explicitlyRequestedMore: false };
    }
    const laterMessages = db
      .select({ text: schema.discussionMessages.text, at: schema.discussionMessages.createdAt })
      .from(schema.discussionMessages)
      .where(
        and(
          eq(schema.discussionMessages.sessionId, sessionId),
          eq(schema.discussionMessages.participantId, participantId),
          eq(schema.discussionMessages.scenarioOrder, scenarioOrder)
        )
      )
      .all()
      .filter((m) => m.at > firstMinimal);
    const laterRequests = db
      .select({ at: schema.interventionEvaluations.evaluatedAt })
      .from(schema.interventionEvaluations)
      .where(
        and(
          eq(schema.interventionEvaluations.sessionId, sessionId),
          eq(schema.interventionEvaluations.scenarioOrder, scenarioOrder),
          eq(schema.interventionEvaluations.targetParticipantId, participantId),
          eq(schema.interventionEvaluations.evaluationSource, "personal_request")
        )
      )
      .all()
      .filter((r) => r.at > firstMinimal);
    return {
      minimalSupportReceived: true,
      confusionAfterMinimal: laterMessages.some((m) => isConfusion(m.text)),
      explicitlyRequestedMore: laterRequests.length > 0,
    };
  }

  /**
   * Stores the current recommendation for this member and scenario unless an
   * identical unresolved one exists. Returns the stored row.
   */
  ensureRecommendation(input: {
    sessionId: string;
    participantId: string;
    scenarioOrder: number;
    lookback: number;
    interventionId?: string | null;
  }) {
    const history = this.buildHistory(input.sessionId, input.participantId, input.scenarioOrder, input.lookback);
    const recommendation = this.recommendLevel(history, input.lookback);
    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(schema.scaffoldRecommendations)
        .where(
          and(
            eq(schema.scaffoldRecommendations.participantId, input.participantId),
            eq(schema.scaffoldRecommendations.scenarioOrder, input.scenarioOrder),
            eq(schema.scaffoldRecommendations.engineVersion, ENGINE_VERSION),
            isNull(schema.scaffoldRecommendations.resolvedAt)
          )
        )
        .orderBy(desc(schema.scaffoldRecommendations.createdAt))
        .get();
      if (
        existing &&
        !input.interventionId &&
        existing.recommendedLevel === recommendation.level &&
        existing.recommendedSupportType === recommendation.supportType
      ) {
        return { row: existing, recommendation };
      }
      const row = tx
        .insert(schema.scaffoldRecommendations)
        .values({
          sessionId: input.sessionId,
          participantId: input.participantId,
          scenarioOrder: input.scenarioOrder,
          interventionId: input.interventionId ?? null,
          engineVersion: ENGINE_VERSION,
          recommendedLevel: recommendation.level,
          recommendedSupportType: recommendation.supportType,
          fadingApplied: recommendation.fadingApplied,
          evidence: recommendation.evidence,
          rationale: recommendation.rationale,
        })
        .returning()
        .get();
      return { row, recommendation };
    });
  }

  /**
   * Records what the member actually chose against the open recommendation(s).
   * Choosing a more direct level than recommended is an override, and allowed.
   */
  async recordOutcome(input: {
    sessionId: string;
    participantId: string;
    scenarioOrder: number;
    chosenSupportType: string;
    interventionId?: string;
  }) {
    const open = await db
      .select()
      .from(schema.scaffoldRecommendations)
      .where(
        and(
          eq(schema.scaffoldRecommendations.sessionId, input.sessionId),
          eq(schema.scaffoldRecommendations.participantId, input.participantId),
          eq(schema.scaffoldRecommendations.scenarioOrder, input.scenarioOrder),
          isNull(schema.scaffoldRecommendations.resolvedAt)
        )
      );
    const targets = input.interventionId
      ? open.filter((r) => r.interventionId === input.interventionId)
      : open.filter((r) => !r.interventionId);
    if (targets.length === 0) return 0;
    const chosenLevel = contentLevel(input.chosenSupportType);
    for (const row of targets) {
      await db
        .update(schema.scaffoldRecommendations)
        .set({
          chosenSupportType: input.chosenSupportType,
          chosenLevel,
          overridden: chosenLevel !== null && chosenLevel > row.recommendedLevel,
          resolvedAt: new Date().toISOString(),
        })
        .where(inArray(schema.scaffoldRecommendations.id, [row.id]));
    }
    return targets.length;
  }
}

export const adaptiveEngine = new AdaptiveScaffoldingEngine();
