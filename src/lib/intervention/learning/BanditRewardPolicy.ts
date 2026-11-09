import type { AdaptivePrivatePolicy, LearningAwareRewards } from "../policies";
import type { DifficultyResolved, OutcomeValidity, ProgressFeedbackResponse } from "../types";
import { ADAPTIVE_ARMS, observeBeta, type AdaptiveArm, type Beta, type LearnerState } from "../adaptive/LearnerModel";
import { applySignal, type SignalResult, type SupportAmountRating } from "../adaptive/rewards";

/**
 * reward-v2-3: posterior updates for policy-v2-3 learner models. Pure.
 *
 * The signals are kept in separate channels so engagement is never counted as
 * learning:
 * - receptiveness: explicit Yes / No thanks / Not now only. An expired offer is
 *   missing data (it may never have been seen), so it changes nothing.
 * - help effectiveness (the Thompson arms): the member's own "did this help you
 *   make progress?" answer, or a corroborated observed outcome at half weight.
 *   "Partly" adds a fractional pseudo-count to both sides (a documented
 *   approximation of a Bernoulli observation, not a probability of knowledge).
 * - activity: whether any own contribution followed; engagement only, never
 *   used to choose help.
 * - independence: managing a scenario without AI help, or saying help was not
 *   needed, versus saying it was needed. Using more direct Step 2 help is logged
 *   as observed higher support usage and changes nothing.
 * The V2 rules (rewards.ts) stay unchanged for older policies.
 */

export type LearningSignal =
  | { kind: "offer_response"; response: "accepted" | "dismissed" | "deferred"; pauseSeconds?: number | null }
  | { kind: "offer_expired"; seen: boolean }
  | { kind: "progress_feedback"; arm: AdaptiveArm; response: ProgressFeedbackResponse }
  | {
      kind: "observed_outcome";
      arm: AdaptiveArm;
      resolved: DifficultyResolved;
      activityResumed: boolean | null;
      validity: OutcomeValidity;
      wasVisible: boolean | null;
    }
  | { kind: "scenario_outcome"; outcome: "independent" | "higher_support_used" | "neutral" }
  | { kind: "self_reported_difficulty" }
  | { kind: "survey_rating"; supportAmount: SupportAmountRating }
  | { kind: "pace_gaps"; gaps: number[] };

export type RewardChannel =
  | "receptiveness"
  | "help_effectiveness"
  | "activity_response"
  | "independence"
  | "pace"
  | "none";

export interface LearningSignalResult extends SignalResult {
  /** Logged with the event: which channels changed and why (or why nothing changed). */
  detail: {
    rewardVersion: string;
    channels: RewardChannel[];
    updateApplied: boolean;
    evidenceQuality: "explicit" | "observed" | "missing" | "not_applicable";
    note: string;
  };
}

const freshActivity = (): Record<AdaptiveArm, Beta> =>
  Object.fromEntries(ADAPTIVE_ARMS.map((arm) => [arm, { alpha: 1, beta: 1 }])) as Record<AdaptiveArm, Beta>;

export function applyLearningSignal(
  state: LearnerState,
  signal: LearningSignal,
  policy: AdaptivePrivatePolicy,
  rewards: LearningAwareRewards
): LearningSignalResult {
  const w = rewards;
  const unchanged = (
    evidenceQuality: LearningSignalResult["detail"]["evidenceQuality"],
    note: string
  ): LearningSignalResult => ({
    state,
    changed: false,
    reward: null,
    weight: 0,
    detail: { rewardVersion: w.rewardVersion, channels: ["none"], updateApplied: false, evidenceQuality, note },
  });
  const done = (
    next: LearnerState,
    reward: number | null,
    weight: number,
    channels: RewardChannel[],
    evidenceQuality: LearningSignalResult["detail"]["evidenceQuality"],
    note: string
  ): LearningSignalResult => ({
    state: { ...next, updates: state.updates + 1 },
    changed: true,
    reward,
    weight,
    detail: { rewardVersion: w.rewardVersion, channels, updateApplied: true, evidenceQuality, note },
  });

  switch (signal.kind) {
    case "offer_response": {
      if (signal.response === "accepted") {
        return done(
          { ...state, receptiveness: observeBeta(state.receptiveness, true, w.accepted) },
          1,
          w.accepted,
          ["receptiveness"],
          "explicit",
          "accepted the offer"
        );
      }
      const weight = signal.response === "dismissed" ? w.dismissed : w.deferred;
      let next: LearnerState = { ...state, receptiveness: observeBeta(state.receptiveness, false, weight) };
      const channels: RewardChannel[] = ["receptiveness"];
      // "Not now" says this pause was normal working time for this member.
      if (signal.response === "deferred" && signal.pauseSeconds && signal.pauseSeconds >= policy.burstMergeSeconds) {
        next = applySignal(next, { kind: "pace_gaps", gaps: [Math.min(signal.pauseSeconds, policy.maxGapSeconds)] }, policy).state;
        next = { ...next, updates: state.updates };
        channels.push("pace");
      }
      return done(
        next,
        0,
        weight,
        channels,
        "explicit",
        signal.response === "dismissed" ? "declined the offer" : "chose Not now (a weak signal: not proof of no need)"
      );
    }
    case "offer_expired":
      return unchanged(
        "missing",
        signal.seen
          ? "offer expired after being displayed without an answer: missing data, not a refusal"
          : "offer expired with no evidence it was ever displayed: missing data"
      );
    case "progress_feedback": {
      const arm = state.arms[signal.arm];
      switch (signal.response) {
        case "yes":
          return done(
            {
              ...state,
              arms: { ...state.arms, [signal.arm]: observeBeta(arm, true, w.feedbackYes) },
              independence: observeBeta(state.independence, false, w.helpUseful),
            },
            1,
            w.feedbackYes,
            ["help_effectiveness", "independence"],
            "explicit",
            "member said the help moved them forward"
          );
        case "partly":
          return done(
            {
              ...state,
              arms: {
                ...state.arms,
                [signal.arm]: { alpha: arm.alpha + w.feedbackPartly, beta: arm.beta + w.feedbackPartly },
              },
            },
            0.5,
            2 * w.feedbackPartly,
            ["help_effectiveness"],
            "explicit",
            "member said the help partly moved them forward (fractional pseudo-count on both sides)"
          );
        case "no":
          return done(
            { ...state, arms: { ...state.arms, [signal.arm]: observeBeta(arm, false, w.feedbackNo) } },
            0,
            w.feedbackNo,
            ["help_effectiveness"],
            "explicit",
            "member said the help did not move them forward"
          );
        case "not_needed":
          return done(
            { ...state, independence: observeBeta(state.independence, true, w.notNeeded) },
            null,
            w.notNeeded,
            ["independence"],
            "explicit",
            "member said they did not need the help; help effectiveness unchanged"
          );
        case "skip":
          return unchanged("missing", "member skipped the question");
      }
      return unchanged("missing", "unknown feedback");
    }
    case "observed_outcome": {
      if (signal.wasVisible !== true) return unchanged("missing", "no evidence the help was seen");
      let next = state;
      const channels: RewardChannel[] = [];
      let reward: number | null = null;
      let weight = 0;
      const notes: string[] = [];
      if (signal.activityResumed !== null && signal.validity !== "insufficient_evidence") {
        const activity = state.activity ?? freshActivity();
        next = {
          ...next,
          activity: {
            ...activity,
            [signal.arm]: observeBeta(activity[signal.arm], signal.activityResumed, w.activityResponse),
          },
        };
        channels.push("activity_response");
        notes.push(signal.activityResumed ? "own activity followed (engagement only)" : "no own activity in the window (engagement only)");
      }
      const arm = state.arms[signal.arm];
      if (signal.validity === "usable" && signal.resolved !== "unknown") {
        const o = w.observedOutcome;
        const updated =
          signal.resolved === "yes"
            ? observeBeta(arm, true, o)
            : signal.resolved === "no"
              ? observeBeta(arm, false, o)
              : { alpha: arm.alpha + o / 2, beta: arm.beta + o / 2 };
        next = { ...next, arms: { ...next.arms, [signal.arm]: updated } };
        channels.push("help_effectiveness");
        reward = signal.resolved === "yes" ? 1 : signal.resolved === "no" ? 0 : 0.5;
        weight = o;
        notes.push(`observed difficulty resolved: ${signal.resolved} (half weight)`);
      } else {
        notes.push(
          signal.validity === "usable"
            ? "whether the difficulty was resolved is unknown: help effectiveness unchanged"
            : `outcome ${signal.validity}: help effectiveness unchanged`
        );
      }
      if (channels.length === 0) return unchanged(signal.validity === "usable" ? "observed" : "missing", notes.join("; "));
      return done(next, reward, weight, channels, "observed", notes.join("; "));
    }
    case "scenario_outcome":
      if (signal.outcome === "independent") {
        return done(
          { ...state, independence: observeBeta(state.independence, true, w.independentScenario) },
          1,
          w.independentScenario,
          ["independence"],
          "observed",
          "contributed to the scenario without any AI help"
        );
      }
      return unchanged(
        "not_applicable",
        signal.outcome === "higher_support_used"
          ? "observed higher support usage: recorded, not a judgement of independence"
          : "used minimal or no help without own contribution: no update"
      );
    case "self_reported_difficulty":
      return done(
        { ...state, independence: observeBeta(state.independence, false, w.selfReportedDifficulty) },
        0,
        w.selfReportedDifficulty,
        ["independence"],
        "explicit",
        "member wrote that they were unsure (once per scenario)"
      );
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
        weight,
        ["receptiveness"],
        "explicit",
        `support amount rated ${signal.supportAmount}`
      );
    }
    case "pace_gaps": {
      const result = applySignal(state, signal, policy);
      return {
        ...result,
        detail: {
          rewardVersion: w.rewardVersion,
          channels: result.changed ? ["pace"] : ["none"],
          updateApplied: result.changed,
          evidenceQuality: "observed",
          note: "time between own contributions (noisy behavioural proxy)",
        },
      };
    }
  }
}
