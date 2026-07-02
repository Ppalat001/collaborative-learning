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
  discussionText: string;
  draftAnswer: string;
  scaffoldingType: ScaffoldingType | null;
  aiResponse: string | null;
  finalAnswer: string;
  discussionStartedAt: string | null;
  scaffoldingRequestedAt: string | null;
  aiResponseAt: string | null;
  finalAnswerAt: string | null;
  submitted: boolean;
}

export const SCAFFOLDING_OPTIONS: {
  type: ScaffoldingType;
  label: string;
  description: string;
}[] = [
  {
    type: "hint",
    label: "Small hint",
    description: "A brief nudge without revealing the answer",
  },
  {
    type: "guiding_question",
    label: "Guiding question",
    description: "Questions to prompt your group's reasoning",
  },
  {
    type: "explanation",
    label: "Brief explanation",
    description: "A short conceptual explanation, not a full solution",
  },
  {
    type: "example",
    label: "Example",
    description: "An analogous example to illustrate the approach",
  },
  {
    type: "feedback",
    label: "Feedback on your answer",
    description: "Comments on a draft answer your group provides",
  },
  {
    type: "summary",
    label: "Summary of discussion",
    description: "A neutral summary of what your group has discussed",
  },
  {
    type: "task_splitting",
    label: "Help splitting the task",
    description: "Suggestions for dividing work among members",
  },
  {
    type: "conflict_support",
    label: "Help with disagreement",
    description: "Facilitation when group members disagree",
  },
  {
    type: "full_answer",
    label: "Full expert answer",
    description: "A complete model answer for comparison (use carefully)",
  },
  {
    type: "no_assistance",
    label: "No assistance",
    description: "Continue without AI support for this request",
  },
];
