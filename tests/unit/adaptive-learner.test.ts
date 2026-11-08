import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createRng,
  decideAdaptiveOffer,
  sampleBeta,
  type AdaptiveContext,
} from "@/lib/intervention/adaptive/AdaptivePrivatePolicy";
import {
  ADAPTIVE_ARMS,
  ARM_LEVEL,
  betaMean,
  initialState,
  logGamma,
  observePace,
  paceMedianSeconds,
  pausePercentile,
  studentTCdf,
  type AdaptiveArm,
  type LearnerState,
} from "@/lib/intervention/adaptive/LearnerModel";
import { applySignal, contributionGaps, type ScenarioOutcome } from "@/lib/intervention/adaptive/rewards";
import { getPolicy } from "@/lib/intervention/policies";

const policy = getPolicy("policy-v2-2").adaptivePrivate!;
const START = "2026-01-01T10:00:00.000Z";
const at = (base: string, seconds: number) => new Date(Date.parse(base) + seconds * 1000).toISOString();

function ctx(overrides: Partial<AdaptiveContext> = {}): AdaptiveContext {
  return {
    participantId: "p1",
    scenarioOrder: 1,
    now: at(START, 400),
    online: true,
    submitted: false,
    scenarioStartedAt: START,
    lastOwnContributionAt: at(START, 100),
    ownConfusion: false,
    groupStalled: false,
    offersThisScenario: 0,
    lastOfferAt: null,
    pendingOffer: false,
    lastStepTwoAt: null,
    usedTypes: [],
    lightHelpReceived: false,
    ...overrides,
  };
}

/** A state whose posteriors are so concentrated that sampling is effectively deterministic. */
function sharpState(options: { receptive: boolean; best?: AdaptiveArm }): LearnerState {
  const strong = { alpha: 500, beta: 1 };
  const weak = { alpha: 1, beta: 500 };
  const base = initialState(policy, null);
  return {
    ...base,
    receptiveness: options.receptive ? strong : weak,
    independence: weak,
    arms: {
      guiding_question: options.best === "guiding_question" ? strong : weak,
      hint: options.best === "hint" ? strong : weak,
      explanation: options.best === "explanation" ? strong : weak,
    },
  };
}

describe("Learner model maths", () => {
  test("log-gamma and the Student-t CDF match known values", () => {
    assert.ok(Math.abs(logGamma(5) - Math.log(24)) < 1e-10);
    assert.ok(Math.abs(logGamma(0.5) - Math.log(Math.sqrt(Math.PI))) < 1e-10);
    assert.ok(Math.abs(studentTCdf(0, 5) - 0.5) < 1e-12);
    assert.ok(Math.abs(studentTCdf(1, 1) - 0.75) < 1e-9);
    assert.ok(Math.abs(studentTCdf(2.228, 10) - 0.975) < 1e-3);
    assert.ok(Math.abs(studentTCdf(-1.96, 1e6) - 0.025) < 1e-3);
    assert.ok(Math.abs(studentTCdf(1.3, 7) + studentTCdf(-1.3, 7) - 1) < 1e-12);
  });

  test("seeded Beta sampling is reproducible and has the right mean", () => {
    const a = createRng("seed");
    const b = createRng("seed");
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
    const rng = createRng("mean-check");
    let total = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) total += sampleBeta(rng, 2, 5);
    assert.ok(Math.abs(total / n - 2 / 7) < 0.02);
    const small = createRng("shape-below-one");
    for (let i = 0; i < 200; i++) {
      const x = sampleBeta(small, 0.5, 0.5);
      assert.ok(x >= 0 && x <= 1);
    }
  });

  test("the pre-test score only shifts the independence prior", () => {
    const high = initialState(policy, 1);
    const low = initialState(policy, 0);
    const unknown = initialState(policy, null);
    assert.ok(Math.abs(betaMean(high.independence) - 5 / 6) < 1e-12);
    assert.ok(Math.abs(betaMean(low.independence) - 1 / 6) < 1e-12);
    assert.equal(betaMean(unknown.independence), 0.5);
    assert.deepEqual(initialState(policy, 2).independence, high.independence);
    assert.deepEqual(high.receptiveness, low.receptiveness);
    assert.deepEqual(high.arms, low.arms);
    assert.deepEqual(high.pace, low.pace);
    assert.equal(high.updates, 0);
  });

  test("the same pause means something different for a fast and a slow member", () => {
    let fast = initialState(policy, null).pace;
    let slow = initialState(policy, null).pace;
    assert.ok(Math.abs(paceMedianSeconds(fast) - policy.priors.paceMedianSeconds) < 1e-9);
    for (let i = 0; i < 10; i++) {
      fast = observePace(fast, 15);
      slow = observePace(slow, 150);
    }
    assert.equal(fast.observations, 10);
    assert.ok(paceMedianSeconds(fast) > 15 && paceMedianSeconds(fast) < 25);
    assert.ok(paceMedianSeconds(slow) > 120 && paceMedianSeconds(slow) < 150);
    assert.ok(pausePercentile(fast, 60) > 0.9);
    assert.ok(pausePercentile(slow, 60) < 0.2);
    assert.equal(pausePercentile(fast, 0), 0);
  });

  test("contribution gaps merge bursts and skip what the cursor already covered", () => {
    const times = [0, 3, 5, 40, 42, 100].map((s) => at(START, s));
    assert.deepEqual(contributionGaps(times, null, 10), { gaps: [35, 58], last: at(START, 100) });
    assert.deepEqual(contributionGaps(times, at(START, 42), 10), { gaps: [58], last: at(START, 100) });
    assert.deepEqual(contributionGaps([], at(START, 42), 10), { gaps: [], last: at(START, 42) });
  });
});

describe("Posterior updates (rewards)", () => {
  const state = initialState(policy, null);

  test("offer responses update receptiveness with their weights", () => {
    const accepted = applySignal(state, { kind: "offer_response", response: "accepted" }, policy);
    assert.equal(accepted.state.receptiveness.alpha, state.receptiveness.alpha + policy.weights.accepted);
    assert.equal(accepted.reward, 1);
    assert.equal(accepted.state.updates, 1);

    const dismissed = applySignal(state, { kind: "offer_response", response: "dismissed" }, policy);
    assert.equal(dismissed.state.receptiveness.beta, state.receptiveness.beta + policy.weights.dismissed);
    assert.equal(dismissed.reward, 0);

    const deferred = applySignal(state, { kind: "offer_response", response: "deferred", pauseSeconds: 50 }, policy);
    assert.equal(deferred.state.receptiveness.beta, state.receptiveness.beta + policy.weights.deferred);
    assert.equal(deferred.state.pace.observations, 1, "'Not now' teaches that this pause was normal for the member");

    const expired = applySignal(state, { kind: "offer_response", response: "expired" }, policy);
    assert.equal(expired.state.receptiveness.beta, state.receptiveness.beta + policy.weights.expired);
    assert.equal(expired.state.pace.observations, 0);
  });

  test("help outcomes update only the arm that was used", () => {
    const success = applySignal(state, { kind: "help_outcome", arm: "hint", success: true, reason: "x" }, policy);
    assert.equal(success.state.arms.hint.alpha, state.arms.hint.alpha + 1);
    assert.deepEqual(success.state.arms.guiding_question, state.arms.guiding_question);
    const failure = applySignal(state, { kind: "help_outcome", arm: "explanation", success: false, reason: "x" }, policy);
    assert.equal(failure.state.arms.explanation.beta, state.arms.explanation.beta + 1);
    assert.equal(failure.reward, 0);
  });

  test("scenario outcomes and survey ratings", () => {
    const independent = applySignal(state, { kind: "scenario_outcome", outcome: "independent" }, policy);
    assert.equal(independent.state.independence.alpha, state.independence.alpha + 1);
    const direct = applySignal(state, { kind: "scenario_outcome", outcome: "direct_help" }, policy);
    assert.equal(direct.state.independence.beta, state.independence.beta + 1);
    const neutral = applySignal(state, { kind: "scenario_outcome", outcome: "neutral" }, policy);
    assert.equal(neutral.changed, false);
    assert.equal(neutral.state.updates, 0);

    const tooMuch = applySignal(state, { kind: "survey_rating", supportAmount: "too_much" }, policy);
    assert.equal(tooMuch.state.receptiveness.beta, state.receptiveness.beta + 2);
    const tooLittle = applySignal(state, { kind: "survey_rating", supportAmount: "too_little" }, policy);
    assert.equal(tooLittle.state.receptiveness.alpha, state.receptiveness.alpha + 2);
    const aboutRight = applySignal(state, { kind: "survey_rating", supportAmount: "appropriate" }, policy);
    assert.equal(aboutRight.state.receptiveness.alpha, state.receptiveness.alpha + 1);
  });

  test("pace gaps shorter than a burst are ignored and long gaps are capped", () => {
    assert.equal(applySignal(state, { kind: "pace_gaps", gaps: [2, 5] }, policy).changed, false);
    const capped = applySignal(state, { kind: "pace_gaps", gaps: [100000] }, policy);
    const expected = observePace(state.pace, policy.maxGapSeconds);
    assert.deepEqual(capped.state.pace, expected);
  });
});

describe("Thompson-sampling decision and fixed safety rules", () => {
  const eager = sharpState({ receptive: true, best: "guiding_question" });

  test("every safety rule is checked before anything is learned", () => {
    const cases: [string, Partial<AdaptiveContext>][] = [
      ["scenario_submitted", { submitted: true }],
      ["not_online", { online: false }],
      ["offer_pending", { pendingOffer: true }],
      ["max_offers_reached", { offersThisScenario: policy.maxOffersPerScenario }],
      ["offer_cooldown", { lastOfferAt: at(START, 400 - policy.minSecondsBetweenOffers + 1) }],
      ["scenario_just_started", { scenarioStartedAt: null }],
      ["scenario_just_started", { now: at(START, policy.minSecondsIntoScenario - 1), lastOwnContributionAt: null }],
      ["using_step_two", { lastStepTwoAt: at(START, 400 - policy.stepTwoCooldownSeconds + 1) }],
      ["recently_active", { lastOwnContributionAt: at(START, 400 - policy.minPauseSeconds + 1) }],
      ["no_suitable_help_left", { usedTypes: ["guiding_question", "hint", "explanation"], lightHelpReceived: true }],
    ];
    for (const [reason, overrides] of cases) {
      const decision = decideAdaptiveOffer(eager, ctx(overrides), policy);
      assert.equal(decision.action, "wait", reason);
      assert.equal(decision.reasonCode, reason);
    }
    assert.equal(decideAdaptiveOffer(eager, ctx(), policy).action, "offer");
  });

  test("a member who keeps declining is not offered help even during a long pause", () => {
    const reluctant = sharpState({ receptive: false, best: "guiding_question" });
    const decision = decideAdaptiveOffer(reluctant, ctx({ ownConfusion: true }), policy);
    assert.equal(decision.action, "wait");
    assert.equal(decision.reasonCode, "below_threshold");
    assert.ok(decision.evidence && decision.evidence.score < policy.offerThreshold);
  });

  test("the member's own 'I'm unsure' skips the minimum pause", () => {
    const recent = ctx({ lastOwnContributionAt: at(START, 395) });
    assert.equal(decideAdaptiveOffer(eager, recent, policy).reasonCode, "recently_active");
    const confused = decideAdaptiveOffer(eager, { ...recent, ownConfusion: true }, policy);
    assert.equal(confused.action, "offer");
  });

  test("picks the help with the highest sampled effectiveness, and explanations only after light help", () => {
    const likesExplanations = sharpState({ receptive: true, best: "explanation" });
    const first = decideAdaptiveOffer(likesExplanations, ctx(), policy);
    assert.equal(first.action, "offer");
    assert.notEqual(first.action === "offer" && first.arm, "explanation");
    const later = decideAdaptiveOffer(likesExplanations, ctx({ usedTypes: ["hint"], lightHelpReceived: true }), policy);
    assert.ok(later.action === "offer");
    assert.equal(later.arm, "explanation");
    assert.equal(later.level, 2);

    const offer = decideAdaptiveOffer(eager, ctx(), policy);
    assert.ok(offer.action === "offer");
    assert.equal(offer.arm, "guiding_question");
    assert.equal(offer.level, 1);
    const used = decideAdaptiveOffer(eager, ctx({ usedTypes: ["guiding_question"], lightHelpReceived: true }), policy);
    assert.ok(used.action === "offer");
    assert.notEqual(used.arm, "guiding_question", "help already used in this scenario is not offered again");
  });

  test("decisions are reproducible: one draw per pause, a new draw after the model changes", () => {
    const state = initialState(policy, null);
    const a = decideAdaptiveOffer(state, ctx({ now: at(START, 300) }), policy);
    const b = decideAdaptiveOffer(state, ctx({ now: at(START, 300) }), policy);
    assert.deepEqual(a, b);
    const later = decideAdaptiveOffer(state, ctx({ now: at(START, 500) }), policy);
    assert.equal(a.evidence?.seed, later.evidence?.seed);
    assert.deepEqual(a.evidence?.samples, later.evidence?.samples);
    assert.ok((later.evidence?.pausePercentile ?? 0) >= (a.evidence?.pausePercentile ?? 0));
    const updated = decideAdaptiveOffer({ ...state, updates: 1 }, ctx({ now: at(START, 300) }), policy);
    assert.notEqual(updated.evidence?.seed, a.evidence?.seed);
  });

  test("never offers a full answer or anything above a brief explanation (randomised check)", () => {
    const rng = createRng("fuzz");
    const beta = () => ({ alpha: 0.5 + rng() * 20, beta: 0.5 + rng() * 20 });
    let offers = 0;
    for (let i = 0; i < 2000; i++) {
      const state: LearnerState = {
        ...initialState(policy, rng()),
        receptiveness: beta(),
        independence: beta(),
        arms: { guiding_question: beta(), hint: beta(), explanation: beta() },
        updates: i,
      };
      const used = ADAPTIVE_ARMS.filter(() => rng() < 0.3);
      const context = ctx({
        now: at(START, 60 + rng() * 900),
        lastOwnContributionAt: rng() < 0.2 ? null : at(START, rng() * 60),
        ownConfusion: rng() < 0.3,
        groupStalled: rng() < 0.3,
        usedTypes: used,
        lightHelpReceived: used.some((arm) => ARM_LEVEL[arm] === 1),
      });
      const decision = decideAdaptiveOffer(state, context, policy);
      if (decision.action !== "offer") continue;
      offers++;
      assert.ok(ADAPTIVE_ARMS.includes(decision.arm));
      assert.ok(decision.level <= 2);
      assert.ok(!context.usedTypes.includes(decision.arm));
      if (decision.arm === "explanation") assert.equal(context.lightHelpReceived, true);
      assert.ok(decision.evidence.score >= policy.offerThreshold);
      assert.ok(!decision.explanation.includes("p1"));
      assert.match(decision.explanation, /Only you can see this/);
    }
    assert.ok(offers > 100, `expected a fair number of offers in the fuzz run, got ${offers}`);
  });
});

/**
 * Two members with identical priors and identical activity patterns. One accepts
 * every popup and makes progress afterwards; the other always chooses "No thanks"
 * and rates the support as "too much". Their models must drift apart.
 */
function simulate(participantId: string, behaviour: "accepter" | "decliner") {
  let state = initialState(policy, 0.5);
  const offersPerScenario: number[] = [];
  const arms: AdaptiveArm[] = [];
  const pattern = [20, 60, 100, 340, 380, 420, 460, 500, 540, 580];
  for (let scenario = 1; scenario <= 10; scenario++) {
    const start = at(START, scenario * 3600);
    const contributions = pattern.map((s) => at(start, s));
    let cursor: string | null = null;
    let offers = 0;
    let lastOfferAt: string | null = null;
    const usedTypes: AdaptiveArm[] = [];
    for (let t = 0; t <= 600; t += 5) {
      const now = at(start, t);
      const seen = contributions.filter((c) => c <= now);
      const fresh = seen.filter((c) => !cursor || c > cursor);
      if (fresh.length) {
        const { gaps, last } = contributionGaps(fresh, cursor, policy.burstMergeSeconds);
        state = applySignal(state, { kind: "pace_gaps", gaps }, policy).state;
        cursor = last;
      }
      const decision = decideAdaptiveOffer(
        state,
        {
          participantId,
          scenarioOrder: scenario,
          now,
          online: true,
          submitted: false,
          scenarioStartedAt: start,
          lastOwnContributionAt: seen.at(-1) ?? null,
          ownConfusion: false,
          groupStalled: false,
          offersThisScenario: offers,
          lastOfferAt,
          pendingOffer: false,
          lastStepTwoAt: null,
          usedTypes,
          lightHelpReceived: usedTypes.some((arm) => ARM_LEVEL[arm] === 1),
        },
        policy
      );
      if (decision.action !== "offer") continue;
      offers++;
      lastOfferAt = now;
      if (behaviour === "accepter") {
        state = applySignal(state, { kind: "offer_response", response: "accepted" }, policy).state;
        usedTypes.push(decision.arm);
        arms.push(decision.arm);
        state = applySignal(state, { kind: "help_outcome", arm: decision.arm, success: true, reason: "contributed" }, policy).state;
      } else {
        state = applySignal(state, { kind: "offer_response", response: "dismissed" }, policy).state;
      }
    }
    const outcome: ScenarioOutcome =
      usedTypes.length === 0 ? "independent" : usedTypes.some((arm) => ARM_LEVEL[arm] === 2) ? "direct_help" : "neutral";
    state = applySignal(state, { kind: "scenario_outcome", outcome }, policy).state;
    state = applySignal(
      state,
      { kind: "survey_rating", supportAmount: behaviour === "accepter" ? "appropriate" : "too_much" },
      policy
    ).state;
    offersPerScenario.push(offers);
  }
  return { state, offersPerScenario, arms };
}

describe("Simulation: two members, ten scenarios", () => {
  test("the same priors diverge with each member's own behaviour", () => {
    const accepter = simulate("member-accepts", "accepter");
    const decliner = simulate("member-declines", "decliner");
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    assert.ok(sum(accepter.offersPerScenario.slice(0, 3)) > 0, "the accepter is offered help early on");
    assert.ok(sum(decliner.offersPerScenario.slice(0, 3)) > 0, "the decliner is offered help early on too");
    assert.ok(
      sum(accepter.offersPerScenario.slice(5)) > sum(decliner.offersPerScenario.slice(5)),
      `later offers: accepter ${accepter.offersPerScenario}, decliner ${decliner.offersPerScenario}`
    );
    assert.equal(sum(decliner.offersPerScenario.slice(5)), 0, "the decliner is left alone by the end");
    assert.ok(accepter.offersPerScenario.every((n) => n <= policy.maxOffersPerScenario));

    assert.ok(betaMean(accepter.state.receptiveness) > 0.8);
    assert.ok(betaMean(decliner.state.receptiveness) < 0.15);
    assert.ok(betaMean(decliner.state.independence) > betaMean(accepter.state.independence));
    assert.ok(paceMedianSeconds(accepter.state.pace) < policy.priors.paceMedianSeconds, "both learn their own pace");

    const prior = initialState(policy, 0.5).arms;
    assert.deepEqual(decliner.state.arms, prior, "help the decliner never saw is never rated");
    for (const arm of new Set(accepter.arms)) assert.ok(accepter.state.arms[arm].alpha > prior[arm].alpha);
  });
});
