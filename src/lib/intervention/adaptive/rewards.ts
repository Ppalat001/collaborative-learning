import { isValidSupportAmount, type SupportAmount } from "@/lib/instruments";
import type { AdaptivePrivatePolicy } from "../policies";
import { observeBeta, observePace, type AdaptiveArm, type LearnerState } from "./LearnerModel";

/**
 * Maps what a member did into posterior updates. Pure: the store decides when a
 * signal is due and logs the state before and after every update.
 */

export type OfferResponse = "accepted" | "dismissed" | "deferred" | "expired";
export type ScenarioOutcome = "independent" | "direct_help" | "neutral";
/** The survey's "support amount" answer ("appropriate" is shown as "About right"). */
export type SupportAmountRating = SupportAmount;

export type LearnerSignal =
  | { kind: "offer_response"; response: OfferResponse; pauseSeconds?: number | null }
  | { kind: "help_outcome"; arm: AdaptiveArm; success: boolean; reason: string }
  | { kind: "scenario_outcome"; outcome: ScenarioOutcome }
  | { kind: "survey_rating"; supportAmount: SupportAmountRating }
  | { kind: "pace_gaps"; gaps: number[] };

export interface SignalResult {
  state: LearnerState;
  changed: boolean;
  /** 1 = success, 0 = failure, null when the signal is not a success/failure observation. */
  reward: number | null;
  weight: number;
}

export function isSupportAmountRating(value: unknown): value is SupportAmountRating {
  return typeof value === "string" && isValidSupportAmount(value);
}

export function applySignal(state: LearnerState, signal: LearnerSignal, policy: AdaptivePrivatePolicy): SignalResult {
  const w = policy.weights;
  const unchanged: SignalResult = { state, changed: false, reward: null, weight: 0 };
  const done = (next: LearnerState, reward: number | null, weight: number): SignalResult => ({
    state: { ...next, updates: state.updates + 1 },
    changed: true,
    reward,
    weight,
  });

  switch (signal.kind) {
    case "offer_response": {
      if (signal.response === "accepted") {
        return done({ ...state, receptiveness: observeBeta(state.receptiveness, true, w.accepted) }, 1, w.accepted);
      }
      const weight = signal.response === "dismissed" ? w.dismissed : signal.response === "deferred" ? w.deferred : w.expired;
      let next: LearnerState = { ...state, receptiveness: observeBeta(state.receptiveness, false, weight) };
      // "Not now" says this pause was normal working time for this member.
      if (signal.response === "deferred" && signal.pauseSeconds && signal.pauseSeconds >= policy.burstMergeSeconds) {
        next = { ...next, pace: observePace(next.pace, Math.min(signal.pauseSeconds, policy.maxGapSeconds)) };
      }
      return done(next, 0, weight);
    }
    case "help_outcome": {
      const weight = signal.success ? w.helpSucceeded : w.helpFailed;
      return done(
        { ...state, arms: { ...state.arms, [signal.arm]: observeBeta(state.arms[signal.arm], signal.success, weight) } },
        signal.success ? 1 : 0,
        weight
      );
    }
    case "scenario_outcome": {
      if (signal.outcome === "neutral") return unchanged;
      const success = signal.outcome === "independent";
      const weight = success ? w.independentScenario : w.directHelpScenario;
      return done({ ...state, independence: observeBeta(state.independence, success, weight) }, success ? 1 : 0, weight);
    }
    case "survey_rating": {
      const success = signal.supportAmount !== "too_much";
      const weight =
        signal.supportAmount === "too_much"
          ? w.surveyTooMuch
          : signal.supportAmount === "too_little"
            ? w.surveyTooLittle
            : w.surveyAboutRight;
      return done(
        { ...state, receptiveness: observeBeta(state.receptiveness, success, weight) },
        success ? 1 : 0,
        weight
      );
    }
    case "pace_gaps": {
      const gaps = signal.gaps.filter((gap) => gap >= policy.burstMergeSeconds);
      if (gaps.length === 0) return unchanged;
      let pace = state.pace;
      for (const gap of gaps) pace = observePace(pace, Math.min(gap, policy.maxGapSeconds));
      return done({ ...state, pace }, null, gaps.length);
    }
  }
}

/**
 * Turns a member's own contribution times in one scenario into the gaps between
 * bursts of activity. Contributions closer than `burstMergeSeconds` belong to the
 * same burst; the gap is measured from the end of the previous burst.
 */
export function contributionGaps(
  times: string[],
  previous: string | null,
  burstMergeSeconds: number
): { gaps: number[]; last: string | null } {
  const sorted = [...times].sort();
  let last = previous;
  const gaps: number[] = [];
  for (const at of sorted) {
    if (last && at <= last) continue;
    if (last) {
      const gap = (Date.parse(at) - Date.parse(last)) / 1000;
      if (gap >= burstMergeSeconds) gaps.push(gap);
    }
    last = at;
  }
  return { gaps, last };
}
