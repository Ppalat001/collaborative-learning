import type { DifficultyResolved, OutcomeValidity, ProgressFeedbackResponse, ScaffoldingMove, ScaffoldingTier } from "../types";

/**
 * Per-member scaffolding state for proactive private help (policy-v2-3+). Pure.
 *
 * - minimal: only the lightest help (guiding question, hint) may be offered.
 * - moderate: an explanation may also be offered, only after evidence that
 *   minimal help was not enough in this scenario (the member said so, or wrote
 *   again that they were unsure). Asking Step 2 for more is NOT such evidence.
 * - reassess: moderate help was also not enough; no more proactive offers in
 *   this scenario (the member can still choose any Step 2 help themselves).
 * - no_offer (faded): after repeated independent scenarios, or "I didn't need
 *   it", nothing is offered on inferred need alone; the member's own explicit
 *   "I'm unsure" still allows a minimal offer. A new scenario starts again from
 *   the member's recent record, so fading is never a permanent block.
 * Without reliable evidence the tier does not change.
 */

export interface TierTransition {
  eventType: "escalation" | "reassess" | "fading";
  toTier: ScaffoldingTier;
  move: ScaffoldingMove;
  reasonCode: string;
}

/** Tier at the start of a scenario, from the member's consecutive independent scenarios just before it. */
export function initialTier(independentStreak: number, fadeAfter: number): ScaffoldingTier {
  return fadeAfter > 0 && independentStreak >= fadeAfter ? "no_offer" : "minimal";
}

/** The latest recorded tier for this scenario, or the initial tier when nothing happened yet. */
export function currentTier(events: { toTier: string; createdAt: string }[], initial: ScaffoldingTier): ScaffoldingTier {
  const latest = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  return (latest?.toTier as ScaffoldingTier | undefined) ?? initial;
}

export interface HelpEvidence {
  /** Directness of the help that was delivered (1 minimal, 2 moderate). */
  level: 1 | 2;
  feedback: ProgressFeedbackResponse | null;
  observedResolved: DifficultyResolved;
  validity: OutcomeValidity | null;
}

/** The transition justified by the evidence about one delivered offer, or null to keep the tier. */
export function transitionAfterHelp(tier: ScaffoldingTier, evidence: HelpEvidence): TierTransition | null {
  if (evidence.feedback === "not_needed") {
    return tier === "no_offer"
      ? null
      : { eventType: "fading", toTier: "no_offer", move: "fade", reasonCode: "member_did_not_need_help" };
  }
  const explicitlyInsufficient = evidence.feedback === "no" || evidence.feedback === "partly";
  const observedInsufficient =
    evidence.feedback === null && evidence.validity === "usable" && evidence.observedResolved === "no";
  if (!explicitlyInsufficient && !observedInsufficient) return null;
  const reason = explicitlyInsufficient ? "member_said_help_was_not_enough" : "member_still_unsure_after_help";
  if (evidence.level === 1 && (tier === "minimal" || tier === "no_offer")) {
    return { eventType: "escalation", toTier: "moderate", move: "escalate", reasonCode: `minimal_help_insufficient:${reason}` };
  }
  if (evidence.level === 2 && evidence.feedback !== "partly" && tier !== "reassess") {
    return { eventType: "reassess", toTier: "reassess", move: "remain_silent", reasonCode: `moderate_help_insufficient:${reason}` };
  }
  return null;
}
