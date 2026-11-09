/**
 * Adaptive Scaffolding V2 domain contracts. A group (session) is a V2 group only
 * when it has a `study_assignments` row; everything here is unused by legacy groups.
 */

export const RESEARCH_CONDITIONS = [
  "baseline_private_request",
  "shared_on_demand",
  "proactive_group",
  "dual_adaptive",
  "proactive_adaptive",
] as const;
export type ResearchCondition = (typeof RESEARCH_CONDITIONS)[number];

export function isResearchCondition(value: unknown): value is ResearchCondition {
  return (RESEARCH_CONDITIONS as readonly unknown[]).includes(value);
}

/**
 * Conditions available for newly created groups. `dual_adaptive` is retained
 * only so existing assignments and their historical data remain interpretable.
 */
export const ASSIGNABLE_RESEARCH_CONDITIONS = [
  "baseline_private_request",
  "shared_on_demand",
  "proactive_group",
  "proactive_adaptive",
] as const satisfies readonly ResearchCondition[];
export type AssignableResearchCondition = (typeof ASSIGNABLE_RESEARCH_CONDITIONS)[number];

export function isAssignableResearchCondition(value: unknown): value is AssignableResearchCondition {
  return (ASSIGNABLE_RESEARCH_CONDITIONS as readonly unknown[]).includes(value);
}

export type InterventionScope = "group" | "individual";

export const INTERVENTION_TRIGGERS = [
  "initial_silence",
  "stalled_discussion",
  "explicit_confusion",
  "unresolved_disagreement",
  "possible_participation_imbalance",
  "coordination_request",
  "student_requested",
  /** The per-member learning model judged that this member may benefit from private help. */
  "adaptive_need",
  "none",
] as const;
export type InterventionTrigger = (typeof INTERVENTION_TRIGGERS)[number];

export type DecisionAction = "no_action" | "offer" | "deliver";

export type InterventionStatus =
  | "suggested"
  | "accepted"
  | "dismissed"
  | "deferred"
  | "delivered"
  | "failed"
  | "expired";

/** Process support is a separate category, not a level above direct. */
export type ScaffoldLevel = 1 | 2 | 3 | "process";

export const FEEDBACK_ACTIONS = [
  "viewed",
  "accepted",
  "dismissed",
  "deferred",
  "why_viewed",
  "shared",
] as const;
export type FeedbackAction = (typeof FEEDBACK_ACTIONS)[number];

export function isFeedbackAction(value: unknown): value is FeedbackAction {
  return (FEEDBACK_ACTIONS as readonly unknown[]).includes(value);
}

/** Group-visible collaboration/process support. None of these give the answer. */
export const GROUP_SUPPORT_TYPES = [
  "participation_invitation",
  "discussion_summary",
  "cognitive_division",
  "disagreement_mediation",
  "reasoning_prompt",
  "reflection_checkpoint",
  "perspective_invitation",
] as const;
export type GroupSupportType = (typeof GROUP_SUPPORT_TYPES)[number];

export function isGroupSupportType(value: unknown): value is GroupSupportType {
  return (GROUP_SUPPORT_TYPES as readonly unknown[]).includes(value);
}

/** What members may ask the shared facilitator for by hand. */
export const MANUAL_GROUP_SUPPORT_TYPES: GroupSupportType[] = [
  "discussion_summary",
  "cognitive_division",
  "disagreement_mediation",
  "reasoning_prompt",
  "reflection_checkpoint",
];

/** Private proactive help is limited to the least intrusive content levels. */
export const PRIVATE_OFFER_SUPPORT_TYPES = ["hint", "guiding_question", "explanation"] as const;
export type PrivateOfferSupportType = (typeof PRIVATE_OFFER_SUPPORT_TYPES)[number];

export type InstrumentMode = "off" | "optional" | "required";

export interface StudyFeatures {
  /** Neutral, non-AI opening prompt; the same in every V2 condition. */
  openingPrompt: boolean;
  /** Non-AI checkpoint questions members can raise for the group. */
  checkpoints: boolean;
  /** Optional rotating human role cards. */
  roles: boolean;
  /** Private pre-AI individual idea per scenario. */
  initialIdea: InstrumentMode;
  /** Short personal justification when clicking "I am good". */
  agreementReason: InstrumentMode;
}

export interface ConditionCapabilities {
  privateManual: boolean;
  sharedManual: boolean;
  proactiveGroup: boolean;
  proactivePrivate: boolean;
  fading: boolean;
  /** Members may explicitly share a private AI idea with the group. */
  sharing: boolean;
  /** Private popup offers chosen by the per-member learning model (no opt-in panel). */
  adaptivePrivate: boolean;
}

export interface DiscussionEntry {
  id: string;
  participantId: string;
  text: string;
  createdAt: string;
}

export interface PreviousIntervention {
  id: string;
  trigger: InterventionTrigger;
  scope: InterventionScope;
  status: InterventionStatus;
  initiatedBy: "system" | "participant";
  recipientParticipantId: string | null;
  supportType: string;
  createdAt: string;
}

export interface CollaborationSnapshot {
  sessionId: string;
  scenarioAttemptId: string;
  scenarioOrder: number;
  condition: ResearchCondition;
  /** Frozen roster minus withdrawn / dropped-out members. */
  activeParticipantIds: string[];
  onlineParticipantIds: string[];
  /**
   * When enough members were first continuously connected to this scenario
   * (presence-based, not the attempt's creation time); null if not yet.
   */
  startedAt: string | null;
  lastHumanMessageAt?: string;
  lastHumanEditAt?: string;
  /** Human chat only; AI items live in their own tables. */
  discussion: DiscussionEntry[];
  groupAnswer: string;
  submitted: boolean;
  previousInterventions: PreviousIntervention[];
  /** Members who opted in to private proactive offers. */
  privateOptInParticipantIds: string[];
  now: string;
}

export type ProgressState = "productive" | "stalled" | "unclear";
export type AssessmentSource = "deterministic_rule" | "model_classifier" | "student_request" | "group_state_estimator";

export interface InterventionAssessment {
  trigger: InterventionTrigger;
  evidenceMessageIds: string[];
  evidenceSummary: string;
  confidence: number;
  progressState: ProgressState;
  source: AssessmentSource;
  /** Set when the evidence is one member's own explicit support-seeking. */
  participantId?: string;
}

export interface InterventionDecision {
  action: DecisionAction;
  scope?: InterventionScope;
  targetParticipantId?: string;
  trigger: InterventionTrigger;
  supportType?: string;
  recommendedLevel?: ScaffoldLevel;
  reasonCode: string;
  reasonExplanation: string;
  policyVersion: string;
  condition: ResearchCondition;
  /** The assessment that drove the decision, if any. */
  assessment?: InterventionAssessment;
}

export interface InterventionFeedback {
  interventionId: string;
  participantId: string;
  action: FeedbackAction;
  createdAt: string;
}

/** What a member sees of an intervention; private fields never reach other members. */
export interface InterventionView {
  id: string;
  scenarioOrder: number;
  scope: InterventionScope;
  initiatedBy: "system" | "participant";
  requestedByName: string | null;
  trigger: InterventionTrigger;
  supportType: string;
  supportLabel: string;
  scaffoldLevel: string;
  status: InterventionStatus;
  offerText: string;
  content: string | null;
  reasonExplanation: string;
  aiOrigin: string | null;
  createdAt: string;
  deliveredAt: string | null;
  failureReason: string | null;
  /** This member's own latest feedback on the item. */
  myFeedback: FeedbackAction | null;
  /** Hidden for this member until this time ("Not now"). */
  deferredUntil: string | null;
}

export interface SharedIdeaView {
  id: string;
  scenarioOrder: number;
  participantId: string;
  authorName: string;
  colorIndex: number;
  sharedText: string;
  sourceLabel: string;
  createdAt: string;
}

export interface CheckpointView {
  id: string;
  scenarioOrder: number;
  kind: string;
  text: string;
  raisedByName: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// V2.3 learning-aware contracts (policy-v2-3 and later only). Observation,
// inference, decision, exposure, outcome and learning are kept apart: an
// observed message is not a diagnosis, an offer is not proof it was seen, and
// missing evidence is recorded as missing, never as a negative result.
// ---------------------------------------------------------------------------

export const PROGRESS_STAGES = [
  "task_understanding",
  "idea_generation",
  "evidence_comparison",
  "answer_synthesis",
  "consensus_review",
  "uncertain",
] as const;
export type ProgressStage = (typeof PROGRESS_STAGES)[number];

export const COLLABORATION_STATES = [
  "productive",
  "constructive_disagreement",
  "possible_confusion",
  "possible_stall",
  "coordination_need",
  "unproductive_conflict",
  "uncertain",
] as const;
export type CollaborationState = (typeof COLLABORATION_STATES)[number];

export type ProposedScope = "group" | "individual" | "none";

export type ScaffoldingMove =
  | "remain_silent"
  | "offer_minimal"
  | "maintain"
  | "escalate"
  | "fade"
  | "group_process_prompt";

export type EvidenceKind =
  | "message"
  | "edit"
  | "checkpoint"
  | "initial_idea"
  | "participant_report"
  | "support_request"
  | "rating"
  | "post_intervention_progress"
  | "contextual_classification"
  | "presence"
  | "intervention";

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  at: string;
}

/**
 * A cautious, evidence-linked hypothesis about the group, never a diagnosis of
 * anyone. `confidence` is a heuristic score, not a calibrated probability.
 */
export interface EstimatedGroupState {
  groupCode: string;
  scenarioOrder: number;
  stage: ProgressStage;
  state: CollaborationState;
  confidence: number;
  evidence: EvidenceRef[];
  counterEvidence: EvidenceRef[];
  uncertaintyReasons: string[];
  /** Short machine-readable reasons for the state (e.g. "new_reasons_in_window"). */
  stateReasons: string[];
  inferredAt: string;
  estimatorVersion: string;
  /** Set when an optional model classification refined the deterministic estimate. */
  classifierModel?: string | null;
  classifierNote?: string | null;
}

export interface ProposedIntervention {
  scope: ProposedScope;
  memberId?: string;
  move: ScaffoldingMove;
  supportType?: string;
  rationaleCode: string;
  evidence: EvidenceRef[];
  policyVersion: string;
  confidence: number;
  safeToOffer: boolean;
}

export type DifficultyResolved = "yes" | "partly" | "no" | "unknown";
export type UnderstandingEvidence = "supported" | "contradicted" | "not_assessed";
export const PROGRESS_FEEDBACK_RESPONSES = ["yes", "partly", "no", "not_needed", "skip"] as const;
export type ProgressFeedbackResponse = (typeof PROGRESS_FEEDBACK_RESPONSES)[number];
export type OutcomeValidity = "usable" | "insufficient_evidence" | "confounded";

export function isProgressFeedbackResponse(value: unknown): value is ProgressFeedbackResponse {
  return (PROGRESS_FEEDBACK_RESPONSES as readonly unknown[]).includes(value);
}

/** Observational association only: an outcome never proves the support caused it. */
export interface ObservedOutcome {
  interventionId: string;
  /** "group" for the group-level outcome of a shared prompt, else the member's id. */
  subject: string;
  windowStart: string;
  windowEnd: string;
  activityResumed: boolean | null;
  difficultyResolved: DifficultyResolved;
  /** Where difficultyResolved came from; only "observation" may update an arm on its own. */
  resolutionSource: "feedback" | "observation" | "none";
  understandingEvidence: UnderstandingEvidence;
  participantFeedback: Exclude<ProgressFeedbackResponse, "skip"> | null;
  wasVisible: boolean | null;
  escalatedHelp: boolean;
  confounds: string[];
  validity: OutcomeValidity;
  provenance: EvidenceRef[];
  evaluatorVersion: string;
}

/** Per-member exposure lifecycle; only technically verifiable steps are recorded. */
export const EXPOSURE_KINDS = [
  "server_created",
  "socket_delivered",
  "client_displayed_in_viewport",
  "user_opened",
  "indicator_dismissed",
  "accepted",
  "deferred",
  "dismissed",
  "expired_unseen",
  "expired_seen",
] as const;
export type ExposureKind = (typeof EXPOSURE_KINDS)[number];

/** The kinds a client may report; everything else is recorded by the server. */
export const CLIENT_EXPOSURE_KINDS = [
  "socket_delivered",
  "client_displayed_in_viewport",
  "user_opened",
  "indicator_dismissed",
] as const satisfies readonly ExposureKind[];
export type ClientExposureKind = (typeof CLIENT_EXPOSURE_KINDS)[number];

export function isClientExposureKind(value: unknown): value is ClientExposureKind {
  return (CLIENT_EXPOSURE_KINDS as readonly unknown[]).includes(value);
}

export type ScaffoldingTier = "no_offer" | "minimal" | "moderate" | "reassess";

/** What a member's own client may know about V2.3 behaviour for one scenario. */
export interface LearningAwareMemberState {
  enabled: boolean;
  dismissal: "per_member";
  feedbackEnabled: boolean;
  feedbackDelaySeconds: number;
  /** This member chose "no more suggestions in this scenario". */
  proactiveStopped: boolean;
  /** This member's own progress feedback per intervention id. */
  progressFeedback: Record<string, ProgressFeedbackResponse>;
}
