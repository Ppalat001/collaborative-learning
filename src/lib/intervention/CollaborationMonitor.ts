import type { InterventionPolicy } from "./policies";
import type {
  CollaborationSnapshot,
  DiscussionEntry,
  InterventionAssessment,
  ProgressState,
} from "./types";
import { validateClassifierOutput } from "./validators";

/**
 * Rule-based observation of a group's discussion. Pure: no database or network
 * access, so every rule can be unit tested from a snapshot. The monitor only
 * describes what it observed; whether to act is the decision engine's job.
 *
 * These are heuristics about the discussion, not measurements of learning or
 * proficiency, and never judgements about an individual.
 */

export const MONITOR_VERSION = "monitor-rules-v1";

const CONFUSION = [
  /\b(i'?m|i am|we'?re|we are)\s+(so\s+|really\s+|a bit\s+|kind of\s+)?(stuck|lost|confused)\b/i,
  /\b(i|we)\s+(don'?t|do not|didn'?t)\s+(get|understand|know what|know how)\b/i,
  /\bno idea\b/i,
  /\bconfus(ed|ing)\b/i,
  /\bwhat does .{1,40} mean\b/i,
  /\bnot sure (what|how|where|why)\b/i,
  /\bcan (someone|anyone|you) (help|explain)\b/i,
  /\bmakes no sense\b/i,
];
const SINGULAR = /\b(i|i'?m|me|my|myself)\b/i;
const PLURAL = /\b(we|we'?re|us|our)\b/i;

const COORDINATION = [
  /\b(how|where) (should|do|can|shall) we (start|begin|split|divide|organi[sz]e)\b/i,
  /\bwho (does|should|will|wants to) (what|do|write|take)\b/i,
  /\b(split|divide|share) (the|this|up the) (work|task|question|parts)\b/i,
  /\bwhat should we (do|discuss|write) (first|next)\b/i,
  /\bwhere do we (start|begin)\b/i,
];

const DISAGREEMENT = [
  /\bi (don'?t|do not) (agree|think so|think that'?s right)\b/i,
  /\bi disagree\b/i,
  /\bthat'?s (not right|wrong|not true|not correct)\b/i,
  /\bi('m| am) not (convinced|sure that'?s right)\b/i,
  /\bi see it differently\b/i,
  /^(no|nope|nah)\b[,.! ]/i,
  /\bbut (i think|actually|that ignores|what about)\b/i,
];

const AGREEMENT = [
  /(^|[^a-z])(i )?agree(d)?\b/i,
  /\bmakes sense\b/i,
  /\byou'?re right\b/i,
  /\b(fair|good) (point|enough)\b/i,
  /\blet'?s go with\b/i,
  /\bsounds good\b/i,
  /\b(ok|okay|fine|yes),? (let'?s|we can)\b/i,
];

const REASONING = [/\bbecause\b/i, /\bfor example\b/i, /\bsince\b/i, /\bevidence\b/i, /\bthe reason\b/i, /\bif\b.+\bthen\b/i];

/** Text that tries to steer the AI. Treated as data and withheld from model prompts. */
const PROMPT_INJECTION = [
  /\bignore (all|any|the|your|previous|prior|above)\b.{0,30}\b(instructions|rules|prompt)\b/i,
  /\b(system|developer) prompt\b/i,
  /\byou are now\b/i,
  /\b(change|switch|set) (the )?(research )?(condition|policy|mode)\b/i,
  /\bgive (us|me) the (full|whole|complete|final) answer\b/i,
];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function isConfusion(text: string): boolean {
  return matchesAny(CONFUSION, text);
}

export function isCoordinationRequest(text: string): boolean {
  return matchesAny(COORDINATION, text);
}

export function isDisagreement(text: string): boolean {
  return matchesAny(DISAGREEMENT, text);
}

export function isAgreement(text: string): boolean {
  if (/\b(disagree|don'?t agree|do not agree|not agree)\b/i.test(text)) return false;
  return matchesAny(AGREEMENT, text);
}

export function hasReasoning(text: string): boolean {
  return matchesAny(REASONING, text);
}

export function looksLikePromptInjection(text: string): boolean {
  return matchesAny(PROMPT_INJECTION, text);
}

/** First-person singular help-seeking is personal; "we" is about the group. */
export function isPersonalConfusion(text: string): boolean {
  return isConfusion(text) && SINGULAR.test(text) && !PLURAL.test(text);
}

const ms = (iso: string) => Date.parse(iso);

function sorted(messages: DiscussionEntry[]): DiscussionEntry[] {
  return [...messages].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
}

export interface ProgressResult {
  state: ProgressState;
  reasons: string[];
}

/**
 * Productive struggle is protected: recent edits, several members talking, or a
 * burst of messages all count as progress, even if the discussion is hard.
 */
export function isMeaningfulProgress(
  snapshot: CollaborationSnapshot,
  policy: InterventionPolicy
): ProgressResult {
  const now = ms(snapshot.now);
  const windowStart = now - policy.productiveWindowSeconds * 1000;
  const recent = snapshot.discussion.filter((m) => ms(m.createdAt) >= windowStart);
  const recentSpeakers = new Set(recent.map((m) => m.participantId));
  const reasons: string[] = [];

  if (snapshot.lastHumanEditAt && ms(snapshot.lastHumanEditAt) >= windowStart) {
    reasons.push("the group answer was edited recently");
  }
  if (recentSpeakers.size >= 2) reasons.push(`${recentSpeakers.size} members wrote recently`);
  if (recent.length >= 3) reasons.push(`${recent.length} recent messages`);
  if (reasons.length > 0) return { state: "productive", reasons };

  const lastActivity = Math.max(
    snapshot.lastHumanMessageAt ? ms(snapshot.lastHumanMessageAt) : 0,
    snapshot.lastHumanEditAt ? ms(snapshot.lastHumanEditAt) : 0,
    snapshot.startedAt ? ms(snapshot.startedAt) : 0
  );
  if (lastActivity > 0 && now - lastActivity >= policy.stallSeconds * 1000) {
    return { state: "stalled", reasons: ["no messages or edits for a while"] };
  }
  return { state: "unclear", reasons: ["little recent activity"] };
}

export type DisagreementState = "none" | "resolved" | "productive" | "emerging" | "unresolved";

export interface DisagreementResult {
  state: DisagreementState;
  evidenceMessageIds: string[];
  involvedCount: number;
}

/**
 * Disagreement is normal and often productive. It only counts as "unresolved"
 * when it involves 2+ members, has persisted, shows no agreement afterwards and
 * the exchange has either stopped moving or keeps repeating.
 */
export function classifyDisagreement(
  messages: DiscussionEntry[],
  now: string,
  policy: InterventionPolicy
): DisagreementResult {
  const nowMs = ms(now);
  const recent = sorted(messages).filter(
    (m) => ms(m.createdAt) >= nowMs - policy.recentWindowSeconds * 1000
  );
  const disagreements: DiscussionEntry[] = [];
  const involved = new Set<string>();
  recent.forEach((message, index) => {
    if (!isDisagreement(message.text)) return;
    disagreements.push(message);
    involved.add(message.participantId);
    const previous = recent
      .slice(0, index)
      .reverse()
      .find((m) => m.participantId !== message.participantId);
    if (previous) involved.add(previous.participantId);
  });
  if (disagreements.length === 0) return { state: "none", evidenceMessageIds: [], involvedCount: 0 };

  const evidenceMessageIds = disagreements.map((m) => m.id);
  const first = disagreements[0];
  const last = disagreements[disagreements.length - 1];
  const after = recent.filter((m) => ms(m.createdAt) > ms(last.createdAt));
  if (after.some((m) => isAgreement(m.text))) {
    return { state: "resolved", evidenceMessageIds, involvedCount: involved.size };
  }

  const lastMessage = recent[recent.length - 1];
  const lively = nowMs - ms(lastMessage.createdAt) < policy.productiveWindowSeconds * 1000;
  const sinceFirst = recent.filter((m) => ms(m.createdAt) >= ms(first.createdAt));
  const reasoned = sinceFirst.some((m) => hasReasoning(m.text));
  const persisted = nowMs - ms(first.createdAt) >= policy.disagreementPersistSeconds * 1000;

  if (involved.size >= 2 && persisted && (!lively || disagreements.length >= 3)) {
    if (reasoned && lively) {
      return { state: "productive", evidenceMessageIds, involvedCount: involved.size };
    }
    return { state: "unresolved", evidenceMessageIds, involvedCount: involved.size };
  }
  if (reasoned && lively) return { state: "productive", evidenceMessageIds, involvedCount: involved.size };
  return { state: "emerging", evidenceMessageIds, involvedCount: involved.size };
}

/** Optional model classifier for ambiguous disagreement. Off unless the policy enables it. */
export interface DisagreementClassifier {
  model: string;
  classify(input: { transcript: { id: string; speaker: string; text: string }[] }): Promise<unknown>;
}

export interface MonitorOptions {
  classifier?: DisagreementClassifier | null;
  allowClassifier?: boolean;
}

export interface MonitorResult {
  assessments: InterventionAssessment[];
  progress: ProgressResult;
  classifierModel: string | null;
  classifierNote: string | null;
}

function noneAssessment(progress: ProgressResult, summary: string): InterventionAssessment {
  return {
    trigger: "none",
    evidenceMessageIds: [],
    evidenceSummary: summary,
    confidence: 1,
    progressState: progress.state,
    source: "deterministic_rule",
  };
}

export class CollaborationMonitor {
  constructor(private readonly policy: InterventionPolicy) {}

  isMeaningfulProgress(snapshot: CollaborationSnapshot): ProgressResult {
    return isMeaningfulProgress(snapshot, this.policy);
  }

  classifyDisagreement(snapshot: CollaborationSnapshot): DisagreementResult {
    return classifyDisagreement(snapshot.discussion, snapshot.now, this.policy);
  }

  /** Explicit help-seeking that no other member has responded to yet. */
  detectExplicitNeeds(snapshot: CollaborationSnapshot): InterventionAssessment[] {
    const now = ms(snapshot.now);
    const messages = sorted(snapshot.discussion).filter(
      (m) => ms(m.createdAt) >= now - this.policy.recentWindowSeconds * 1000
    );
    const progress = this.isMeaningfulProgress(snapshot);
    const found: InterventionAssessment[] = [];
    const seen = new Set<string>();

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const answeredByPeer = messages
        .slice(i + 1)
        .some((m) => m.participantId !== message.participantId);
      if (answeredByPeer) continue;

      if (isConfusion(message.text)) {
        const personal = isPersonalConfusion(message.text);
        const key = personal ? `confusion:${message.participantId}` : "confusion:group";
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          trigger: "explicit_confusion",
          evidenceMessageIds: [message.id],
          evidenceSummary: personal
            ? "A member wrote that they are unsure, and nobody has replied yet."
            : "The group wrote that it is unsure how to continue, and nobody has replied yet.",
          confidence: 0.8,
          progressState: progress.state,
          source: "deterministic_rule",
          ...(personal ? { participantId: message.participantId } : {}),
        });
      } else if (isCoordinationRequest(message.text) && !seen.has("coordination")) {
        seen.add("coordination");
        found.push({
          trigger: "coordination_request",
          evidenceMessageIds: [message.id],
          evidenceSummary: "A member asked how the group should organise the work.",
          confidence: 0.75,
          progressState: progress.state,
          source: "deterministic_rule",
        });
      }
    }
    return found;
  }

  /**
   * Silence and stall rules need enough members connected. Imbalance is reported
   * for the group only: no member is named or stored as the cause.
   */
  detectGroupPatterns(snapshot: CollaborationSnapshot): InterventionAssessment[] {
    const policy = this.policy;
    const now = ms(snapshot.now);
    const progress = this.isMeaningfulProgress(snapshot);
    const online = snapshot.onlineParticipantIds.filter((id) =>
      snapshot.activeParticipantIds.includes(id)
    );
    if (online.length < policy.minActiveMembersForGroupTriggers || !snapshot.startedAt) return [];

    const found: InterventionAssessment[] = [];
    const activeForSeconds = (now - ms(snapshot.startedAt)) / 1000;
    const hasAnyActivity = snapshot.discussion.length > 0 || Boolean(snapshot.lastHumanEditAt);

    if (!hasAnyActivity && activeForSeconds >= policy.initialSilenceSeconds) {
      found.push({
        trigger: "initial_silence",
        evidenceMessageIds: [],
        evidenceSummary: `${online.length} members connected for ${Math.round(activeForSeconds)}s with no messages or edits.`,
        confidence: 0.9,
        progressState: progress.state,
        source: "deterministic_rule",
      });
    } else if (hasAnyActivity && progress.state === "stalled") {
      found.push({
        trigger: "stalled_discussion",
        evidenceMessageIds: [],
        evidenceSummary: `No messages or edits for at least ${policy.stallSeconds}s while ${online.length} members were connected.`,
        confidence: 0.7,
        progressState: progress.state,
        source: "deterministic_rule",
      });
    }

    const active = snapshot.activeParticipantIds;
    if (
      active.length >= 2 &&
      snapshot.discussion.length >= policy.imbalanceMinMessages &&
      activeForSeconds >= policy.imbalanceMinActiveSeconds
    ) {
      const counts = new Map<string, number>(active.map((id) => [id, 0]));
      for (const message of snapshot.discussion) {
        if (counts.has(message.participantId)) {
          counts.set(message.participantId, (counts.get(message.participantId) ?? 0) + 1);
        }
      }
      const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
      const top = Math.max(...counts.values());
      if (total > 0 && top / total >= policy.imbalanceTopShare) {
        found.push({
          trigger: "possible_participation_imbalance",
          evidenceMessageIds: [],
          evidenceSummary: `Most of the ${total} messages so far came from one part of the group.`,
          confidence: 0.6,
          progressState: progress.state,
          source: "deterministic_rule",
        });
      }
    }
    return found;
  }

  async evaluate(snapshot: CollaborationSnapshot, options: MonitorOptions = {}): Promise<MonitorResult> {
    const progress = this.isMeaningfulProgress(snapshot);
    if (snapshot.submitted) {
      return {
        assessments: [noneAssessment(progress, "Scenario already submitted.")],
        progress,
        classifierModel: null,
        classifierNote: null,
      };
    }

    const assessments: InterventionAssessment[] = [...this.detectExplicitNeeds(snapshot)];
    let classifierModel: string | null = null;
    let classifierNote: string | null = null;

    const disagreement = this.classifyDisagreement(snapshot);
    if (disagreement.state === "unresolved") {
      assessments.push({
        trigger: "unresolved_disagreement",
        evidenceMessageIds: disagreement.evidenceMessageIds,
        evidenceSummary: `${disagreement.involvedCount} members disagreed and no agreement followed.`,
        confidence: 0.65,
        progressState: progress.state,
        source: "deterministic_rule",
      });
    } else if (
      disagreement.state === "emerging" &&
      options.allowClassifier &&
      options.classifier &&
      this.policy.classifier.enabled
    ) {
      const result = await this.runClassifier(snapshot, options.classifier, disagreement);
      classifierModel = options.classifier.model;
      classifierNote = result.note;
      if (result.assessment) assessments.push(result.assessment);
    }

    assessments.push(...this.detectGroupPatterns(snapshot));

    if (assessments.length === 0) {
      const summary =
        disagreement.state === "productive"
          ? "Disagreement with reasoning is under way; treated as productive."
          : `No difficulty detected (${progress.reasons.join("; ")}).`;
      assessments.push(noneAssessment(progress, summary));
    }
    return { assessments, progress, classifierModel, classifierNote };
  }

  private async runClassifier(
    snapshot: CollaborationSnapshot,
    classifier: DisagreementClassifier,
    disagreement: DisagreementResult
  ): Promise<{ assessment: InterventionAssessment | null; note: string }> {
    const speakers = new Map<string, string>();
    const transcript = sorted(snapshot.discussion)
      .slice(-20)
      .map((m) => {
        if (!speakers.has(m.participantId)) {
          speakers.set(m.participantId, `Member ${String.fromCharCode(65 + speakers.size)}`);
        }
        return {
          id: m.id,
          speaker: speakers.get(m.participantId)!,
          text: looksLikePromptInjection(m.text) ? "[withheld]" : m.text.slice(0, 400),
        };
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.policy.classifier.timeoutMs);
    });
    try {
      const raw = await Promise.race([classifier.classify({ transcript }), timeout]).finally(() =>
        clearTimeout(timer)
      );
      if (raw === "timeout") return { assessment: null, note: "classifier timed out; no action" };
      const parsed = validateClassifierOutput(raw, new Set(transcript.map((m) => m.id)));
      if (!parsed.ok) return { assessment: null, note: `classifier output rejected: ${parsed.reason}` };
      if (parsed.value.label !== "unresolved_disagreement") {
        return { assessment: null, note: `classifier label ${parsed.value.label}` };
      }
      if (parsed.value.confidence < this.policy.classifier.minConfidence) {
        return { assessment: null, note: "classifier confidence below threshold" };
      }
      return {
        note: "classifier confirmed unresolved disagreement",
        assessment: {
          trigger: "unresolved_disagreement",
          evidenceMessageIds: parsed.value.evidenceMessageIds.length
            ? parsed.value.evidenceMessageIds
            : disagreement.evidenceMessageIds,
          evidenceSummary: "A classifier judged a recent disagreement as unresolved.",
          confidence: parsed.value.confidence,
          progressState: this.isMeaningfulProgress(snapshot).state,
          source: "model_classifier",
        },
      };
    } catch (error) {
      return { assessment: null, note: `classifier failed: ${error instanceof Error ? error.message : "error"}` };
    }
  }
}
