import OpenAI from "openai";
import {
  buildScaffoldRequest,
  getMockScaffoldResponse,
} from "@/lib/prompts";
import type { ScaffoldingType, Scenario } from "@/lib/types";

/** Railway values are sometimes saved with quotes or a "Bearer " prefix. */
function readApiKey(): string {
  let key = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  if (key.toLowerCase().startsWith("bearer ")) key = key.slice(7).trim();
  return key;
}

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

  const apiKey = readApiKey();
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

  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  // Newer models reject max_tokens and sometimes temperature. Drop a rejected option and retry.
  const options: { temperature?: number; max_completion_tokens?: number } = {
    temperature: 0.4,
    max_completion_tokens: 500,
  };

  let completion: Awaited<ReturnType<typeof client.chat.completions.create>> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      completion = await client.chat.completions.create({ model, messages, ...options });
      break;
    } catch (error) {
      const unsupported =
        error instanceof Error ? error.message.match(/Unsupported parameter: '([^']+)'/) : null;
      const name = unsupported?.[1];
      if (name === "temperature" || name === "max_completion_tokens") {
        delete options[name];
        continue;
      }
      throw error;
    }
  }
  if (!completion || !("choices" in completion)) {
    throw new Error("The AI returned no response");
  }

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
