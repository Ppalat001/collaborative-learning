export type ScaffoldingType =
  | "hint"
  | "guiding_question"
  | "explanation"
  | "example"
  | "feedback"
  | "summary"
  | "task_splitting"
  | "conflict_support"
  | "full_answer"
  | "no_assistance";

export interface Scenario {
  id: string;
  order: number;
  title: string;
  taskType: string;
  expectedDiscussionMinutes: number;
  description: string;
  promptForGroup: string;
}

export interface DiscussionMessage {
  id: string;
  participantId: string | null;
  authorName: string;
  /** Join order within the session, used to give each member a stable colour. */
  colorIndex: number;
  text: string;
  createdAt: string;
}

export interface ParticipantInfo {
  id: string;
  displayName: string;
  anonymousId: string;
  joinedAt: string;
}

export interface SessionState {
  id: string;
  code: string;
  currentScenarioIndex: number;
  participantCount: number;
  maxParticipants: number;
  consentGiven: boolean;
  completedAt: string | null;
  participants: ParticipantInfo[];
}

export interface ScenarioAttemptState {
  scenarioId: string;
  helpReason: string | null;
  scaffoldingType: ScaffoldingType | null;
  aiResponse: string | null;
  ownWordsExplanation: string;
  finalAnswer: string;
  discussionStartedAt: string | null;
  scaffoldingRequestedAt: string | null;
  aiResponseAt: string | null;
  finalAnswerAt: string | null;
  submitted: boolean;
}

export interface ScaffoldProposal {
  id: string;
  proposedById: string | null;
  proposedByName: string;
  helpReason: string;
  scaffoldingType: ScaffoldingType;
  createdAt: string;
}

/** Agreement is announced through the scaffolding broadcast once the AI has answered. */
export type ProposalEvent =
  | { type: "proposed"; proposal: ScaffoldProposal }
  | { type: "cancelled"; proposal: ScaffoldProposal; byName: string };

/**
 * "content" options sit on a single directness scale (supportLevel 0–3).
 * "process" options support collaboration rather than the answer itself,
 * so they have no position on that scale (supportLevel null).
 */
export type SupportCategory = "none" | "content" | "process";

export type SupportLevel = 0 | 1 | 2 | 3;

export const SUPPORT_LEVEL_LABELS: Record<SupportLevel, string> = {
  0: "None",
  1: "Minimal",
  2: "Moderate",
  3: "Direct",
};

export interface ScaffoldingOption {
  type: ScaffoldingType;
  label: string;
  description: string;
  category: SupportCategory;
  supportLevel: SupportLevel | null;
}

export const SCAFFOLDING_OPTIONS: ScaffoldingOption[] = [
  {
    type: "no_assistance",
    label: "No assistance",
    description: "Continue without AI support for this request",
    category: "none",
    supportLevel: 0,
  },
  {
    type: "hint",
    label: "Small hint",
    description: "A brief nudge without revealing the answer",
    category: "content",
    supportLevel: 1,
  },
  {
    type: "guiding_question",
    label: "Guiding question",
    description: "Questions to prompt your group's reasoning",
    category: "content",
    supportLevel: 1,
  },
  {
    type: "explanation",
    label: "Brief explanation",
    description: "A short conceptual explanation, not a full solution",
    category: "content",
    supportLevel: 2,
  },
  {
    type: "example",
    label: "Example",
    description: "An analogous example to illustrate the approach",
    category: "content",
    supportLevel: 2,
  },
  {
    type: "feedback",
    label: "Feedback on your answer",
    description: "Comments on the ideas your group has so far",
    category: "content",
    supportLevel: 2,
  },
  {
    type: "full_answer",
    label: "Full expert answer",
    description: "A complete model answer for comparison (use carefully)",
    category: "content",
    supportLevel: 3,
  },
  {
    type: "summary",
    label: "Summary of discussion",
    description: "A neutral summary of what your group has discussed",
    category: "process",
    supportLevel: null,
  },
  {
    type: "task_splitting",
    label: "Help splitting the task",
    description: "Suggestions for dividing work among members",
    category: "process",
    supportLevel: null,
  },
  {
    type: "conflict_support",
    label: "Help with disagreement",
    description: "Facilitation when group members disagree",
    category: "process",
    supportLevel: null,
  },
];

export function getScaffoldingOption(
  type: ScaffoldingType
): ScaffoldingOption | undefined {
  return SCAFFOLDING_OPTIONS.find((option) => option.type === type);
}
