import OpenAI from "openai";
import {
  buildScaffoldRequest,
  getMockScaffoldResponse,
} from "@/lib/prompts";
import type { ScaffoldingType, Scenario } from "@/lib/types";

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

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      response: getMockScaffoldResponse(scaffoldingType, scenario),
      model: "mock",
      latencyMs: 0,
      systemPrompt: system,
      userPrompt: user,
      mocked: true,
    };
  }

  // Any OpenAI-compatible provider (OpenRouter, Gemini, Groq) works via OPENAI_BASE_URL.
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const client = new OpenAI({ apiKey, baseURL });
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const start = Date.now();

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.4,
    max_tokens: 500,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const response =
    completion.choices[0]?.message?.content?.trim() ??
    "Unable to generate a response. Please continue your discussion.";

  return {
    response,
    model,
    latencyMs: Date.now() - start,
    systemPrompt: system,
    userPrompt: user,
    mocked: false,
  };
}
