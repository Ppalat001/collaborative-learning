import {
  classifyDisagreement,
  CollaborationMonitor,
  hasReasoning,
  isAgreement,
  isConfusion,
  isDisagreement,
  isMeaningfulProgress,
  looksLikePromptInjection,
  type DisagreementClassifier,
} from "./CollaborationMonitor";
import { learningAwareOf, type InterventionPolicy, type LearningAwarePolicy } from "./policies";
import type {
  CollaborationSnapshot,
  CollaborationState,
  DiscussionEntry,
  EstimatedGroupState,
  EvidenceRef,
  InterventionAssessment,
  ProgressStage,
  ProgressState,
} from "./types";
import { validateClassifierOutput } from "./validators";

/**
 * Cautious, evidence-linked estimate of where a group is (task stage) and how
 * the collaboration is going (interaction state), for policy-v2-3 and later.
 *
 * Pure: it reads only human group chat, answer-edit summaries, checkpoints and
 * the public snapshot, never private Step 2 help or private popups. It compares
 * the recent window with what was said before (new reasons, revised answer,
 * repeated statements) instead of counting words, and it prefers "uncertain"
 * when the evidence is weak, stale or contradictory. A group can disagree and
 * progress at the same time; disagreement is not failure.
 *
 * `confidence` is a heuristic score in [0, 1], not a calibrated probability.
 */

export interface AnswerEditEvidence {
  id: string;
  at: string;
  charsAdded: number;
  charsRemoved: number;
}

export interface CheckpointEvidence {
  id: string;
  kind: string;
  at: string;
}

export interface GroupStateInput {
  groupCode: string;
  snapshot: CollaborationSnapshot;
  /** Edits of the shared group answer in this scenario. */
  edits: AnswerEditEvidence[];
  checkpoints: CheckpointEvidence[];
  policy: InterventionPolicy;
}

/** A member saying they are busy thinking or have it under control. */
const WORKING = [
  /\b(i'?m|i am|we'?re|we are)\s+(still\s+|just\s+)?(thinking|working on it|working on that|reading|writing|on it|looking (it up|into it|at it))\b/i,
  /\b(give|gimme) (me|us) a (sec|second|minute|moment)\b/i,
  /\b(one|a|just a) (sec|second|minute|moment)\b/i,
  /\blet me (think|read|check|write)\b/i,
  /\b(i|we) (got|get) it( now)?\b/i,
  /\bmaking progress\b/i,
  /\b(nearly|almost) (there|done)\b/i,
];

export function reportsOwnProgress(text: string): boolean {
  return !isConfusion(text) && WORKING.some((pattern) => pattern.test(text));
}

const STOP_WORDS = new Set(
  (
    "the and that this with for are but not you your our its was were have has had what which who why how when where " +
    "can could should would will just about they them their there then than also because think yes yeah okay ok agree " +
    "disagree really very more some into from like dont don't i'm we're it's that's thats is be so of to in on a an it " +
    "we i me my us or if at as by no do does did all any one too maybe well still sure right wrong point"
  ).split(" ")
);

export function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .map((t) => t.replace(/'s$/, "").replace(/^'+|'+$/g, ""))
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
  );
}

export function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

interface MessageFeature {
  entry: DiscussionEntry;
  at: number;
  /** Introduces content not said before (and is not a near-copy of an earlier message). */
  novel: boolean;
  /** Near-copy of an earlier message. */
  repeated: boolean;
  reasoning: boolean;
  disagreement: boolean;
  agreement: boolean;
  working: boolean;
}

const ms = (iso: string) => Date.parse(iso);
const round = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

function analyse(messages: DiscussionEntry[], la: LearningAwarePolicy): MessageFeature[] {
  const ordered = [...messages].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const seenTokens = new Set<string>();
  const earlier: Set<string>[] = [];
  return ordered.map((entry) => {
    const tokens = contentTokens(entry.text);
    const maxSimilarity = earlier.reduce((max, previous) => Math.max(max, tokenSimilarity(tokens, previous)), 0);
    const fresh = [...tokens].filter((t) => !seenTokens.has(t)).length;
    const repeated = tokens.size >= 3 && maxSimilarity >= la.estimator.repetitionSimilarity;
    const novel = tokens.size >= 3 && !repeated && fresh >= 2;
    earlier.push(tokens);
    for (const token of tokens) seenTokens.add(token);
    return {
      entry,
      at: ms(entry.createdAt),
      novel,
      repeated,
      reasoning: hasReasoning(entry.text),
      disagreement: isDisagreement(entry.text),
      agreement: isAgreement(entry.text),
      working: reportsOwnProgress(entry.text),
    };
  });
}

const messageRef = (f: MessageFeature): EvidenceRef => ({ id: f.entry.id, kind: "message", at: f.entry.createdAt });
const editRef = (e: AnswerEditEvidence): EvidenceRef => ({ id: e.id, kind: "edit", at: e.at });
const checkpointRef = (c: CheckpointEvidence): EvidenceRef => ({ id: c.id, kind: "checkpoint", at: c.at });

function uniqueRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(`${r.kind}:${r.id}`) ? false : (seen.add(`${r.kind}:${r.id}`), true)));
}

/** Substantive revisions only: a typo fix is not progress. */
const SUBSTANTIVE_EDIT_CHARS = 10;

export class GroupStateEstimator {
  estimate(input: GroupStateInput): EstimatedGroupState {
    const la = learningAwareOf(input.policy);
    if (!la) throw new Error(`Policy ${input.policy.version} has no learning-aware settings`);
    const { snapshot, policy } = input;
    const now = ms(snapshot.now);
    const windowStart = now - la.estimator.progressWindowSeconds * 1000;
    const features = analyse(snapshot.discussion, la);
    const recent = features.filter((f) => f.at >= windowStart);
    const recentEdits = input.edits.filter(
      (e) => ms(e.at) >= windowStart && e.charsAdded + e.charsRemoved >= SUBSTANTIVE_EDIT_CHARS
    );
    const recentCheckpoints = input.checkpoints.filter((c) => ms(c.at) >= windowStart);

    const base = {
      groupCode: input.groupCode,
      scenarioOrder: snapshot.scenarioOrder,
      inferredAt: snapshot.now,
      estimatorVersion: la.estimatorVersion,
    };
    const stage = this.estimateStage(snapshot, features, recent, recentEdits, recentCheckpoints, la);
    const result = (
      state: CollaborationState,
      confidence: number,
      parts: { evidence?: EvidenceRef[]; counter?: EvidenceRef[]; reasons?: string[]; uncertainty?: string[] }
    ): EstimatedGroupState => ({
      ...base,
      stage,
      state,
      confidence: round(clamp(confidence)),
      evidence: uniqueRefs(parts.evidence ?? []),
      counterEvidence: uniqueRefs(parts.counter ?? []),
      stateReasons: parts.reasons ?? [],
      uncertaintyReasons: parts.uncertainty ?? [],
    });

    if (snapshot.submitted) return result("uncertain", 0, { uncertainty: ["scenario_submitted"] });
    const online = snapshot.onlineParticipantIds.filter((id) => snapshot.activeParticipantIds.includes(id));
    if (!snapshot.startedAt || online.length < policy.minActiveMembersForGroupTriggers) {
      return result("uncertain", 0, { uncertainty: ["group_not_present"] });
    }

    const novelRecent = recent.filter((f) => f.novel);
    const newReasons = novelRecent.filter((f) => f.reasoning);
    const novelSpeakers = new Set(novelRecent.map((f) => f.entry.participantId));
    const progressRefs = [...novelRecent.map(messageRef), ...recentEdits.map(editRef)];
    const uncertainty: string[] = [];

    // 1. Disagreement: constructive while new reasons or answer revisions keep coming,
    //    unproductive when the same positions are repeated without anything new.
    const disagreement = classifyDisagreement(snapshot.discussion, snapshot.now, policy);
    if (disagreement.state !== "none" && disagreement.state !== "resolved") {
      const disagreementRefs = features
        .filter((f) => disagreement.evidenceMessageIds.includes(f.entry.id))
        .map(messageRef);
      const firstDisagreementAt = Math.min(...disagreementRefs.map((r) => ms(r.at)));
      const repeatedRecent = recent.filter((f) => f.repeated);
      const loop =
        repeatedRecent.length >= la.estimator.minRepeatedMessagesForLoop &&
        newReasons.length === 0 &&
        recentEdits.length === 0 &&
        now - firstDisagreementAt >= la.estimator.loopMinSeconds * 1000;
      if (loop || (disagreement.state === "unresolved" && newReasons.length === 0 && recentEdits.length === 0)) {
        return this.withStaleness(
          result("unproductive_conflict", loop ? 0.75 : 0.6, {
            evidence: [...disagreementRefs, ...repeatedRecent.map(messageRef)],
            counter: progressRefs,
            reasons: [loop ? "repeated_positions_without_new_reasons" : "unresolved_without_new_reasons"],
          }),
          now,
          la
        );
      }
      if (newReasons.length > 0 || recentEdits.length > 0 || disagreement.state === "productive") {
        return this.withStaleness(
          result("constructive_disagreement", 0.6 + 0.08 * Math.min(newReasons.length, 3) + (recentEdits.length ? 0.05 : 0), {
            evidence: [...newReasons.map(messageRef), ...recentEdits.map(editRef)],
            counter: disagreementRefs,
            reasons: [
              newReasons.length > 0 ? "new_reasons_during_disagreement" : "answer_revised_during_disagreement",
            ],
          }),
          now,
          la
        );
      }
      uncertainty.push("emerging_disagreement");
    }

    // 2. Explicit, unanswered group-level needs (a member's own "I'm unsure" is private, not a group state).
    const explicit = new CollaborationMonitor(policy).detectExplicitNeeds(snapshot);
    const groupConfusion = explicit.find((a) => a.trigger === "explicit_confusion" && !a.participantId);
    const coordination = explicit.find((a) => a.trigger === "coordination_request");
    const personal = explicit.filter((a) => a.trigger === "explicit_confusion" && a.participantId);
    const refsFor = (a: InterventionAssessment) =>
      features.filter((f) => a.evidenceMessageIds.includes(f.entry.id)).map(messageRef);
    const personalReasons = personal.length ? ["member_reported_confusion"] : [];
    if (groupConfusion) {
      return this.withContradictions(
        result("possible_confusion", 0.75, {
          evidence: refsFor(groupConfusion),
          reasons: ["unanswered_group_confusion", ...personalReasons],
          uncertainty,
        }),
        newReasons,
        novelSpeakers
      );
    }
    if (coordination) {
      return this.withContradictions(
        result("coordination_need", 0.7, {
          evidence: refsFor(coordination),
          reasons: ["unanswered_coordination_request", ...personalReasons],
          uncertainty,
        }),
        newReasons,
        novelSpeakers
      );
    }

    // 3. Stall: nothing at all since the start, or no messages/edits for the stall time.
    //    Low message volume alone is never a stall; a recent "let me think" lowers confidence.
    const hasAnyActivity = snapshot.discussion.length > 0 || Boolean(snapshot.lastHumanEditAt);
    const activeForSeconds = (now - ms(snapshot.startedAt)) / 1000;
    if (!hasAnyActivity && activeForSeconds >= policy.initialSilenceSeconds) {
      return result("possible_stall", 0.7, {
        evidence: [{ id: `presence:${snapshot.startedAt}`, kind: "presence", at: snapshot.startedAt }],
        reasons: ["no_activity_since_start"],
        uncertainty,
      });
    }
    const progress = isMeaningfulProgress(snapshot, policy);
    if (progress.state === "stalled") {
      const lastActivity = Math.max(
        snapshot.lastHumanMessageAt ? ms(snapshot.lastHumanMessageAt) : 0,
        snapshot.lastHumanEditAt ? ms(snapshot.lastHumanEditAt) : 0,
        ms(snapshot.startedAt)
      );
      const idleRatio = (now - lastActivity) / (policy.stallSeconds * 1000);
      const lastMessages = features.slice(-2);
      const working = lastMessages.filter((f) => f.working);
      const confidence = Math.min(0.85, 0.6 + 0.25 * (idleRatio - 1)) - (working.length ? 0.3 : 0);
      return result("possible_stall", confidence, {
        evidence: [{ id: `idle:${new Date(lastActivity).toISOString()}`, kind: "presence", at: new Date(lastActivity).toISOString() }],
        counter: working.map(messageRef),
        reasons: [`no_messages_or_edits_for_${Math.round((now - lastActivity) / 1000)}s`, ...personalReasons],
        uncertainty: working.length ? [...uncertainty, "members_said_they_were_working"] : uncertainty,
      });
    }

    // 4. Progress: new content, new reasons or a substantive answer revision in the window.
    if (newReasons.length > 0 || recentEdits.length > 0 || (novelRecent.length >= 2 && novelSpeakers.size >= 1)) {
      const confidence =
        0.55 +
        0.1 * Math.min(novelSpeakers.size, 2) +
        (recentEdits.length ? 0.1 : 0) +
        (newReasons.length ? 0.1 : 0);
      return this.withStaleness(
        result("productive", Math.min(confidence, 0.9), {
          evidence: [...progressRefs, ...recentCheckpoints.map(checkpointRef)],
          reasons: [
            ...(newReasons.length ? ["new_reasons_in_window"] : []),
            ...(recentEdits.length ? ["answer_revised_in_window"] : []),
            ...(novelRecent.length ? ["new_content_in_window"] : []),
            ...personalReasons,
          ],
          uncertainty,
        }),
        now,
        la
      );
    }
    return result("uncertain", 0.3, {
      evidence: recent.map(messageRef),
      reasons: personalReasons,
      uncertainty: [...uncertainty, recent.length ? "activity_without_new_content" : "little_recent_activity"],
    });
  }

  /** Coarse task stage from checkpoints, answer state and what kind of talk dominates the window. */
  private estimateStage(
    snapshot: CollaborationSnapshot,
    features: MessageFeature[],
    recent: MessageFeature[],
    recentEdits: AnswerEditEvidence[],
    recentCheckpoints: CheckpointEvidence[],
    la: LearningAwarePolicy
  ): ProgressStage {
    const answerLength = snapshot.groupAnswer.trim().length;
    if (features.length === 0 && answerLength === 0) return "task_understanding";
    const latestCheckpoint = [...recentCheckpoints].sort((a, b) => ms(a.at) - ms(b.at)).at(-1);
    if (latestCheckpoint?.kind === "agreed") return "consensus_review";
    if (latestCheckpoint?.kind === "disputed" || latestCheckpoint?.kind === "evidence") return "evidence_comparison";
    if (latestCheckpoint?.kind === "missing") return "answer_synthesis";
    if (answerLength >= la.estimator.answerSynthesisMinChars && recent.some((f) => f.agreement) && recentEdits.length === 0) {
      return "consensus_review";
    }
    if (answerLength >= la.estimator.answerSynthesisMinChars && recentEdits.length > 0) return "answer_synthesis";
    if (recent.filter((f) => f.reasoning || f.disagreement).length >= 2) return "evidence_comparison";
    if (features.length < 4 && answerLength === 0) return "task_understanding";
    if (recent.some((f) => f.novel)) return "idea_generation";
    return "uncertain";
  }

  /** Old evidence halves the confidence: the situation may have moved on. */
  private withStaleness(estimate: EstimatedGroupState, now: number, la: LearningAwarePolicy): EstimatedGroupState {
    const latest = Math.max(0, ...estimate.evidence.map((r) => ms(r.at)).filter(Number.isFinite));
    if (latest > 0 && now - latest > la.estimator.staleEvidenceSeconds * 1000) {
      return {
        ...estimate,
        confidence: round(estimate.confidence * 0.5),
        uncertaintyReasons: [...estimate.uncertaintyReasons, "stale_evidence"],
      };
    }
    return estimate;
  }

  /** New reasons from several members contradict a "need" state; lower confidence instead of ignoring them. */
  private withContradictions(
    estimate: EstimatedGroupState,
    newReasons: MessageFeature[],
    novelSpeakers: Set<string>
  ): EstimatedGroupState {
    if (newReasons.length === 0 || novelSpeakers.size < 2) return estimate;
    return {
      ...estimate,
      confidence: round(Math.max(0, estimate.confidence - 0.2)),
      counterEvidence: uniqueRefs([...estimate.counterEvidence, ...newReasons.map(messageRef)]),
      uncertaintyReasons: [...estimate.uncertaintyReasons, "contradictory_progress"],
    };
  }
}

export const groupStateEstimator = new GroupStateEstimator();

/**
 * Turns a repetition loop the rule monitor did not flag into an assessment, so it
 * goes through the same decision gates, caps and logging as every other trigger.
 */
export function estimatorAssessments(
  estimate: EstimatedGroupState,
  existing: InterventionAssessment[],
  progressState: ProgressState
): InterventionAssessment[] {
  if (estimate.state !== "unproductive_conflict") return [];
  if (existing.some((a) => a.trigger === "unresolved_disagreement")) return [];
  return [
    {
      trigger: "unresolved_disagreement",
      evidenceMessageIds: estimate.evidence.filter((r) => r.kind === "message").map((r) => r.id),
      evidenceSummary: "The group repeated the same competing positions for a while without new reasons.",
      confidence: estimate.confidence,
      progressState,
      source: "group_state_estimator",
    },
  ];
}

/**
 * Optional model refinement of an ambiguous disagreement estimate. Only the
 * labels and evidence ids validated against the transcript are used; on
 * timeout, invalid output or error the deterministic estimate stands, marked
 * with the reason. The caller rate-limits calls.
 */
export async function refineWithClassifier(
  estimate: EstimatedGroupState,
  snapshot: CollaborationSnapshot,
  classifier: DisagreementClassifier,
  la: LearningAwarePolicy
): Promise<EstimatedGroupState> {
  const ambiguous =
    estimate.state === "unproductive_conflict" ||
    estimate.state === "constructive_disagreement" ||
    estimate.uncertaintyReasons.includes("emerging_disagreement");
  if (!ambiguous) return estimate;

  const speakers = new Map<string, string>();
  const transcript = [...snapshot.discussion]
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
    .slice(-20)
    .map((m) => {
      if (!speakers.has(m.participantId)) speakers.set(m.participantId, `Member ${String.fromCharCode(65 + speakers.size)}`);
      return {
        id: m.id,
        speaker: speakers.get(m.participantId)!,
        text: looksLikePromptInjection(m.text) ? "[withheld]" : m.text.slice(0, 400),
      };
    });
  const fallback = (note: string): EstimatedGroupState => ({
    ...estimate,
    classifierModel: classifier.model,
    classifierNote: note,
    uncertaintyReasons: [...estimate.uncertaintyReasons, "classifier_unavailable"],
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), la.classifier.timeoutMs);
  });
  try {
    const raw = await Promise.race([classifier.classify({ transcript }), timeout]).finally(() => clearTimeout(timer));
    if (raw === "timeout") return fallback("classifier timed out; deterministic estimate kept");
    const parsed = validateClassifierOutput(raw, new Set(transcript.map((m) => m.id)));
    if (!parsed.ok) return fallback(`classifier output rejected: ${parsed.reason}`);
    const { label, confidence, evidenceMessageIds } = parsed.value;
    if (confidence < la.classifier.minConfidence || label === "none") {
      return { ...estimate, classifierModel: classifier.model, classifierNote: `classifier label ${label} (${confidence}); deterministic estimate kept` };
    }
    const state: CollaborationState = label === "unresolved_disagreement" ? "unproductive_conflict" : "constructive_disagreement";
    const cited = evidenceMessageIds.map((id): EvidenceRef => ({
      id,
      kind: "message",
      at: snapshot.discussion.find((m) => m.id === id)?.createdAt ?? snapshot.now,
    }));
    return {
      ...estimate,
      state,
      confidence: round(Math.min(estimate.confidence, confidence) + (state === estimate.state ? 0.1 : 0)),
      evidence: uniqueRefs([
        ...(state === estimate.state ? estimate.evidence : []),
        ...cited,
        { id: `classifier:${classifier.model}`, kind: "contextual_classification", at: snapshot.now },
      ]),
      stateReasons: [...estimate.stateReasons, `classifier_${label}`],
      uncertaintyReasons: estimate.uncertaintyReasons.filter((r) => r !== "emerging_disagreement"),
      classifierModel: classifier.model,
      classifierNote: `classifier label ${label} (${confidence})`,
    };
  } catch (error) {
    return fallback(`classifier failed: ${error instanceof Error ? error.message : "error"}`);
  }
}
