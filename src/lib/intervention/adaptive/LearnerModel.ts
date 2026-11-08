import type { AdaptivePrivatePolicy, BetaPrior } from "../policies";

/**
 * Per-member Bayesian learner model behind the private popup offers. Pure: no
 * database access, so every update rule can be unit tested.
 *
 * Every member starts from the same versioned priors (only the independence
 * prior is shifted by the member's own pre-test score). The posteriors are then
 * updated from that member's own behaviour only; nothing is shared between members.
 */

export const ADAPTIVE_ARMS = ["guiding_question", "hint", "explanation"] as const;
export type AdaptiveArm = (typeof ADAPTIVE_ARMS)[number];

/** Directness on the Step 2 scale: guiding questions and hints are minimal, explanations moderate. */
export const ARM_LEVEL: Record<AdaptiveArm, 1 | 2> = {
  guiding_question: 1,
  hint: 1,
  explanation: 2,
};

export function isAdaptiveArm(value: unknown): value is AdaptiveArm {
  return (ADAPTIVE_ARMS as readonly unknown[]).includes(value);
}

export interface Beta {
  alpha: number;
  beta: number;
}

/**
 * Normal-Inverse-Gamma posterior over the mean and variance of log(seconds
 * between this member's own contributions).
 */
export interface PacePosterior {
  mu: number;
  kappa: number;
  a: number;
  b: number;
  observations: number;
}

export interface LearnerState {
  pace: PacePosterior;
  /** Probability that the member manages a scenario without needing direct help. */
  independence: Beta;
  /** Probability that the member welcomes an offer at all. */
  receptiveness: Beta;
  /** Probability that each kind of help is followed by the member's own progress. */
  arms: Record<AdaptiveArm, Beta>;
  /** Last own contribution already folded into the pace estimate. */
  paceCursor: { scenarioOrder: number; at: string } | null;
  /** Number of posterior updates applied; part of every decision seed. */
  updates: number;
}

const toBeta = ([alpha, beta]: BetaPrior): Beta => ({ alpha, beta });

export function initialPace(priors: AdaptivePrivatePolicy["priors"]): PacePosterior {
  const kappa = priors.pacePseudoObservations;
  const a = kappa / 2 + 1;
  return {
    mu: Math.log(priors.paceMedianSeconds),
    kappa,
    a,
    b: priors.paceLogSd ** 2 * (a - 1),
    observations: 0,
  };
}

/** `pretestFraction` is the member's own pre-test score / max score, or null when unknown. */
export function initialState(policy: AdaptivePrivatePolicy, pretestFraction: number | null): LearnerState {
  const { priors } = policy;
  const fraction =
    pretestFraction === null || !Number.isFinite(pretestFraction) ? 0.5 : Math.min(1, Math.max(0, pretestFraction));
  return {
    pace: initialPace(priors),
    independence: {
      alpha: 1 + fraction * priors.independenceStrength,
      beta: 1 + (1 - fraction) * priors.independenceStrength,
    },
    receptiveness: toBeta(priors.receptiveness),
    arms: {
      guiding_question: toBeta(priors.arms.guiding_question),
      hint: toBeta(priors.arms.hint),
      explanation: toBeta(priors.arms.explanation),
    },
    paceCursor: null,
    updates: 0,
  };
}

export function betaMean(value: Beta): number {
  return value.alpha / (value.alpha + value.beta);
}

export function observeBeta(value: Beta, success: boolean, weight: number): Beta {
  return success ? { ...value, alpha: value.alpha + weight } : { ...value, beta: value.beta + weight };
}

/** Conjugate update with one observed gap (seconds). */
export function observePace(pace: PacePosterior, gapSeconds: number): PacePosterior {
  const x = Math.log(Math.max(gapSeconds, 1));
  const kappa = pace.kappa + 1;
  return {
    mu: (pace.kappa * pace.mu + x) / kappa,
    kappa,
    a: pace.a + 0.5,
    b: pace.b + (pace.kappa * (x - pace.mu) ** 2) / (2 * kappa),
    observations: pace.observations + 1,
  };
}

/** Typical gap for this member (posterior median of the gap). */
export function paceMedianSeconds(pace: PacePosterior): number {
  return Math.exp(pace.mu);
}

/**
 * Share of this member's own gaps (posterior predictive, Student-t on the log
 * scale) that are shorter than the current pause. 0.9 means the pause is longer
 * than 90% of the gaps this member usually leaves.
 */
export function pausePercentile(pace: PacePosterior, pauseSeconds: number): number {
  if (pauseSeconds <= 0) return 0;
  const scale = Math.sqrt((pace.b * (pace.kappa + 1)) / (pace.a * pace.kappa));
  return studentTCdf((Math.log(pauseSeconds) - pace.mu) / scale, 2 * pace.a);
}

export interface StateSummary {
  paceMedianSeconds: number;
  paceObservations: number;
  independence: number;
  receptiveness: number;
  arms: Record<AdaptiveArm, number>;
  updates: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function summarizeState(state: LearnerState): StateSummary {
  return {
    paceMedianSeconds: round(paceMedianSeconds(state.pace)),
    paceObservations: state.pace.observations,
    independence: round(betaMean(state.independence)),
    receptiveness: round(betaMean(state.receptiveness)),
    arms: {
      guiding_question: round(betaMean(state.arms.guiding_question)),
      hint: round(betaMean(state.arms.hint)),
      explanation: round(betaMean(state.arms.explanation)),
    },
    updates: state.updates,
  };
}

// ---------------------------------------------------------------------------
// Student-t CDF through the regularized incomplete beta function.
// ---------------------------------------------------------------------------

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const shifted = z - 1;
  let sum = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) sum += LANCZOS[i] / (shifted + i);
  const t = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-14) break;
  }
  return h;
}

export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(x, a, b)) / a
    : 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

export function studentTCdf(t: number, df: number): number {
  const tail = 0.5 * regularizedBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}
