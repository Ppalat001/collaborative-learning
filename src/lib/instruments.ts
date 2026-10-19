export const ANSWER_WORD_LIMIT = 500;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export const SHARED_FIELDS = ["finalAnswer"] as const;

export const MAX_MESSAGE_LENGTH = 2000;

export const PARTICIPANT_COLORS = [
  {
    name: "text-indigo-700",
    bubble: "border-indigo-200 bg-indigo-50",
    dot: "bg-indigo-600",
    highlight: "bg-indigo-100 text-indigo-900",
  },
  {
    name: "text-emerald-700",
    bubble: "border-emerald-200 bg-emerald-50",
    dot: "bg-emerald-600",
    highlight: "bg-emerald-100 text-emerald-900",
  },
  {
    name: "text-amber-700",
    bubble: "border-amber-200 bg-amber-50",
    dot: "bg-amber-500",
    highlight: "bg-amber-100 text-amber-900",
  },
  {
    name: "text-rose-700",
    bubble: "border-rose-200 bg-rose-50",
    dot: "bg-rose-600",
    highlight: "bg-rose-100 text-rose-900",
  },
];

export function participantColor(colorIndex: number) {
  return colorIndex >= 0 ? PARTICIPANT_COLORS[colorIndex % PARTICIPANT_COLORS.length] : null;
}

export type SharedField = (typeof SHARED_FIELDS)[number];

export function isSharedField(value: string): value is SharedField {
  return (SHARED_FIELDS as readonly string[]).includes(value);
}

export type SurveyRatingKey =
  | "perceivedHelpfulness"
  | "aiHelpedDiscussion"
  | "aiHelpedFocus"
  | "aiHelpedInclusion"
  | "aiHelpedDisagreement"
  | "collaborationRating"
  | "sharedAnswerRating"
  | "autonomyRating"
  | "aiHelpedThinking"
  | "overRelianceRating"
  | "couldAnswerWithoutAi"
  | "satisfactionRating";

export interface SurveyItem {
  key: SurveyRatingKey;
  label: string;
  /** Only asked when this participant selected at least one AI support option. */
  aiOnly: boolean;
  /** Offers "Not applicable", stored as null. */
  allowNotApplicable?: boolean;
}

export const SURVEY_SECTIONS: { title: string; items: SurveyItem[] }[] = [
  {
    title: "AI support",
    items: [
      {
        key: "perceivedHelpfulness",
        label: "The AI support I chose was helpful for this scenario.",
        aiOnly: true,
      },
    ],
  },
  {
    title: "Collaboration",
    items: [
      {
        key: "aiHelpedDiscussion",
        label: "My AI support helped me contribute better to the group discussion.",
        aiOnly: true,
      },
      {
        key: "aiHelpedFocus",
        label: "My AI support helped me stay focused on the task.",
        aiOnly: true,
      },
      {
        key: "aiHelpedInclusion",
        label: "My AI support helped me include others' ideas in the discussion.",
        aiOnly: true,
      },
      {
        key: "aiHelpedDisagreement",
        label: "My AI support helped our group resolve disagreement.",
        aiOnly: true,
        allowNotApplicable: true,
      },
      {
        key: "collaborationRating",
        label: "Our group collaborated well on this scenario.",
        aiOnly: false,
      },
      {
        key: "sharedAnswerRating",
        label: "Our final answer was a genuinely shared group answer.",
        aiOnly: false,
      },
    ],
  },
  {
    title: "Autonomy and reliance on AI",
    items: [
      {
        key: "autonomyRating",
        label: "I still felt in control of the task.",
        aiOnly: false,
      },
      {
        key: "aiHelpedThinking",
        label: "The AI helped me think, rather than thinking for me.",
        aiOnly: true,
      },
      {
        key: "overRelianceRating",
        label: "I relied too much on the AI.",
        aiOnly: true,
      },
      {
        key: "couldAnswerWithoutAi",
        label: "I could have contributed to this answer without the AI.",
        aiOnly: true,
      },
    ],
  },
  {
    title: "Overall",
    items: [
      {
        key: "satisfactionRating",
        label: "I am satisfied with how our group handled this scenario.",
        aiOnly: false,
      },
    ],
  },
];

export const SURVEY_ITEMS: SurveyItem[] = SURVEY_SECTIONS.flatMap((s) => s.items);

export const LIKERT_LABELS = [
  "Strongly disagree",
  "Disagree",
  "Neutral",
  "Agree",
  "Strongly agree",
];

export const SUPPORT_AMOUNTS = [
  { id: "too_little", label: "Too little" },
  { id: "appropriate", label: "About right" },
  { id: "too_much", label: "Too much" },
] as const;

export type SupportAmount = (typeof SUPPORT_AMOUNTS)[number]["id"];

export function isValidSupportAmount(value: string): value is SupportAmount {
  return SUPPORT_AMOUNTS.some((amount) => amount.id === value);
}

export const FINAL_REFLECTION_QUESTIONS = [
  {
    id: "ai_effect_on_collaboration",
    text: "How did the AI support affect the way your group worked together?",
  },
  {
    id: "most_useful_support",
    text: "Which type of AI support was most useful for you, and why?",
  },
  {
    id: "unhelpful_or_too_much",
    text: "Was any AI support unhelpful or too much? Please explain.",
  },
  {
    id: "thinking_and_reliance",
    text: "Did you ever feel the AI was doing the thinking for your group? When?",
  },
  {
    id: "ai_into_group_answer",
    text: "Did you bring ideas from your private AI support into the group discussion or answer? How?",
  },
  {
    id: "private_vs_shared_ai",
    text: "Would you prefer AI support to be private (only you see it) or shared with the whole group? Why?",
  },
  {
    id: "participation",
    text: "Did everyone in your group contribute fairly? What affected this?",
  },
  {
    id: "agreement_on_answer",
    text: "When you clicked \"I am good\", did you really agree with the group answer? Why or why not?",
  },
  {
    id: "learned_most",
    text: "What is the most important thing you learned from this activity?",
  },
  {
    id: "suggested_changes",
    text: "What would you change about the AI support or the activity?",
  },
] as const;

export const RUBRIC_CRITERIA = [
  { key: "correctness", label: "Correctness" },
  { key: "clarity", label: "Clarity" },
  { key: "reasoning", label: "Reasoning" },
  { key: "completeness", label: "Completeness" },
  { key: "useOfExamples", label: "Use of examples" },
  { key: "depth", label: "Depth of understanding" },
] as const;

export type RubricCriterion = (typeof RUBRIC_CRITERIA)[number]["key"];

export const RUBRIC_SCALE = [
  { value: 1, label: "1 · Weak" },
  { value: 2, label: "2 · Developing" },
  { value: 3, label: "3 · Good" },
  { value: 4, label: "4 · Strong" },
];
