import { callResponsesApi, readApiKey } from "@/lib/ai/provider";
import {
  buildScaffoldRequest,
  getMockScaffoldResponse,
} from "@/lib/prompts";
import type { ScaffoldingType, Scenario } from "@/lib/types";

export function describeAiError(error: unknown): string {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 0;
  const raw = error instanceof Error ? error.message : "Unknown error";
  const message = raw.replace(/sk-[A-Za-z0-9_-]+/g, "sk-…").slice(0, 300);

  if (status === 401) {
    return "OpenAI rejected the API key. In Railway, OPENAI_API_KEY must be only the key (sk-...), with no quotes, and the service must be redeployed.";
  }
  if (status === 429) {
    return "OpenAI refused the request: the account has no remaining credit or is rate-limited. Add billing credit in the OpenAI dashboard, then try again.";
  }
  if (status === 404) {
    return `OpenAI could not find the model. Check OPENAI_MODEL. ${message}`;
  }
  return `The AI could not respond${status ? ` (${status})` : ""}: ${message}`;
}

export interface ScaffoldResult {
  response: string;
  model: string;
  latencyMs: number;
  systemPrompt: string;
  userPrompt: string;
  mocked: boolean;
}

export async function generateScaffoldResponse(
  scaffoldingType: ScaffoldingType,
  scenario: Scenario,
  discussionText: string,
  groupAnswer = ""
): Promise<ScaffoldResult> {
  const { system, user } = buildScaffoldRequest(scaffoldingType, {
    scenario,
    discussionText,
    groupAnswer,
  });

  if (scaffoldingType === "no_assistance") {
    return {
      response: getMockScaffoldResponse(scaffoldingType, scenario),
      model: "none",
      latencyMs: 0,
      systemPrompt: system,
      userPrompt: user,
      mocked: true,
    };
  }

  if (!readApiKey()) {
    return {
      response: getMockScaffoldResponse(scaffoldingType, scenario),
      model: "mock",
      latencyMs: 0,
      systemPrompt: system,
      userPrompt: user,
      mocked: true,
    };
  }

  // Current models (including gpt-6-luna) answer through /v1/responses, not chat completions.
  const result = await callResponsesApi({ system, user, maxOutputTokens: 800 });

  return {
    response: result.text || "Unable to generate a response. Please continue your discussion.",
    model: result.model,
    latencyMs: result.latencyMs,
    systemPrompt: system,
    userPrompt: user,
    mocked: false,
  };
}
