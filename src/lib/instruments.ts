export const HELP_REASONS = [
  { id: "stuck", label: "We are stuck" },
  { id: "unsure_correct", label: "We are not sure if our answer is correct" },
  { id: "need_example", label: "We need an example" },
  { id: "disagree", label: "We disagree" },
  { id: "need_explanation", label: "We need a better explanation" },
  { id: "want_feedback", label: "We want feedback" },
  { id: "no_help_needed", label: "We don't need help right now" },
] as const;

export type HelpReason = (typeof HELP_REASONS)[number]["id"];

export function isValidHelpReason(value: string): value is HelpReason {
  return HELP_REASONS.some((reason) => reason.id === value);
}

export function getHelpReasonLabel(id: string | null | undefined): string {
  return HELP_REASONS.find((reason) => reason.id === id)?.label ?? "";
}

export const OWN_WORDS_MIN_WORDS = 15;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export const SHARED_FIELDS = ["ownWordsExplanation", "finalAnswer"] as const;

export const MAX_MESSAGE_LENGTH = 2000;

export const PARTICIPANT_COLORS = [
  { name: "text-indigo-700", bubble: "border-indigo-200 bg-indigo-50" },
  { name: "text-emerald-700", bubble: "border-emerald-200 bg-emerald-50" },
  { name: "text-amber-700", bubble: "border-amber-200 bg-amber-50" },
  { name: "text-rose-700", bubble: "border-rose-200 bg-rose-50" },
];

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
  /** Only asked when the group received AI support (not "No assistance"). */
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
        label: "The AI support was helpful for this scenario.",
        aiOnly: true,
      },
    ],
  },
  {
    title: "Collaboration",
    items: [
      {
        key: "aiHelpedDiscussion",
        label: "The AI support helped our group discuss the task better.",
        aiOnly: true,
      },
      {
        key: "aiHelpedFocus",
        label: "The AI support helped our group stay focused.",
        aiOnly: true,
      },
      {
        key: "aiHelpedInclusion",
        label: "The AI support helped include everyone in the discussion.",
        aiOnly: true,
      },
      {
        key: "aiHelpedDisagreement",
        label: "The AI support helped our group resolve disagreement.",
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
        label: "Our group relied too much on the AI.",
        aiOnly: true,
      },
      {
        key: "couldAnswerWithoutAi",
        label: "Our group could have answered this without the AI.",
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
    text: "Which type of AI support was most useful for your group, and why?",
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
    id: "participation",
    text: "Did everyone in your group contribute fairly? What affected this?",
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
