import type { ScaffoldingType, Scenario } from "@/lib/types";

export interface ScaffoldPromptContext {
  scenario: Scenario;
  discussionText: string;
  draftAnswer?: string;
}

const BASE_SYSTEM_PROMPT = `You are a learning support agent in a collaborative educational research study.
Your role is to scaffold group learning — never to replace human collaboration or autopilot the task.
Keep responses concise (2–4 short paragraphs max unless the scaffolding type requires less).
Address the group collectively ("your group", "you all").
Do not ask follow-up questions unless the scaffolding type explicitly requires questions.`;

const SCAFFOLDING_RULES: Record<ScaffoldingType, string> = {
  hint: `Provide ONE small hint that nudges the group's thinking forward.
Do NOT reveal the final answer, key conclusion, or step-by-step solution.
The hint should help them notice something they may have overlooked.`,

  guiding_question: `Provide ONE or TWO guiding questions only.
Do NOT state the correct answer or strong conclusions.
Questions should prompt the group to reason, compare options, or examine assumptions.`,

  explanation: `Provide a brief conceptual explanation related to the scenario.
Do NOT give the group's final answer or a complete solution.
Focus on clarifying concepts, not resolving the dilemma for them.`,

  example: `Provide ONE analogous example that illustrates how to approach this type of problem.
Do NOT apply the example directly as the answer to this scenario.
Make clear it is an analogy, not the solution.`,

  feedback: `Review the group's draft answer (if provided) and discussion.
Name at least one strength and one or two specific areas to revise or deepen.
Do NOT rewrite the full answer for them — guide improvement only.`,

  summary: `Summarize the group's discussion neutrally and accurately.
Do NOT add new arguments, conclusions, or recommendations they have not raised.
Help them see the structure of what they have already said.`,

  task_splitting: `Suggest how the group could divide this task among 2–4 members fairly.
Propose concrete roles or sub-questions each person could tackle.
Do NOT complete the task for any member.`,

  conflict_support: `The group may be experiencing disagreement. Facilitate productive dialogue.
Encourage respectful comparison of ideas using clear criteria.
Do NOT pick a side or declare which member is correct.`,

  full_answer: `The group explicitly requested a full expert answer for comparison.
Provide a clear, well-reasoned model answer to the scenario.
Note that they should compare this to their own reasoning — not copy it.`,

  no_assistance: `Return exactly: "Proceed with your discussion. No AI assistance will be provided for this request."`,
};

function buildUserMessage(context: ScaffoldPromptContext): string {
  const { scenario, discussionText, draftAnswer } = context;
  const parts = [
    `Scenario title: ${scenario.title}`,
    `Task type: ${scenario.taskType}`,
    `Scenario description: ${scenario.description}`,
    `Prompt for the group: ${scenario.promptForGroup}`,
    "",
    `Group discussion so far:`,
    discussionText.trim() || "(No discussion recorded yet)",
  ];

  if (draftAnswer?.trim()) {
    parts.push("", `Group draft answer:`, draftAnswer.trim());
  }

  return parts.join("\n");
}

export function buildScaffoldMessages(context: ScaffoldPromptContext): {
  system: string;
  user: string;
} {
  const scaffoldingType = context.scenario
    ? ("scaffoldingType" in context
        ? (context as ScaffoldPromptContext & { scaffoldingType: ScaffoldingType })
            .scaffoldingType
        : null)
    : null;

  return {
    system: BASE_SYSTEM_PROMPT,
    user: buildUserMessage(context),
  };
}

export function getScaffoldSystemPrompt(scaffoldingType: ScaffoldingType): string {
  return `${BASE_SYSTEM_PROMPT}\n\nScaffolding type: ${scaffoldingType}\n\nRules for this scaffolding type:\n${SCAFFOLDING_RULES[scaffoldingType]}`;
}

export function buildScaffoldRequest(
  scaffoldingType: ScaffoldingType,
  context: ScaffoldPromptContext
): { system: string; user: string } {
  if (scaffoldingType === "no_assistance") {
    return {
      system: BASE_SYSTEM_PROMPT,
      user: buildUserMessage(context),
    };
  }

  return {
    system: getScaffoldSystemPrompt(scaffoldingType),
    user: buildUserMessage(context),
  };
}

export function getMockScaffoldResponse(
  scaffoldingType: ScaffoldingType,
  scenario: Scenario
): string {
  const responses: Record<ScaffoldingType, string> = {
    hint: `Consider whether your group has defined what a good ${scenario.taskType.replace("_", " ")} response must include before debating specifics.`,
    guiding_question: `What criteria is your group using to evaluate options, and are those criteria shared by everyone?`,
    explanation: `This type of task often requires separating facts from interpretations before reaching a recommendation.`,
    example: `Similar to choosing between study methods, groups often benefit from listing constraints first, then matching options to those constraints.`,
    feedback: `Strength: your group is engaging with multiple perspectives. Area to revise: make your recommendation criteria explicit before concluding.`,
    summary: `Your group has discussed the scenario from several angles and is working toward a shared position, though some trade-offs remain unresolved.`,
    task_splitting: `Member A could gather evidence, Member B could map pros/cons, Member C could draft the recommendation, and Member D could review for gaps.`,
    conflict_support: `Try stating each position in one sentence, then identify one criterion you all agree matters for this decision.`,
    full_answer: `[Model answer for "${scenario.title}"] A strong response would define evaluation criteria, address counterarguments, and justify one clear recommendation with evidence.`,
    no_assistance: `Proceed with your discussion. No AI assistance will be provided for this request.`,
  };

  return responses[scaffoldingType];
}
