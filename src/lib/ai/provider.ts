import OpenAI from "openai";

/** Railway values are sometimes saved with quotes or a "Bearer " prefix. */
export function readApiKey(): string {
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

export function isRealAiConfigured(): boolean {
  return readApiKey().length > 0;
}

export function getConfiguredModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function providerHost(): string {
  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  if (!baseURL) return "api.openai.com";
  try {
    return new URL(baseURL).host;
  } catch {
    return "custom";
  }
}

/** "real:api.openai.com:gpt-4o-mini" or "mock:none:mock"; stored with every V2 group. */
export function describeModelConfig(): { aiMode: "real" | "mock"; version: string } {
  if (!isRealAiConfigured()) return { aiMode: "mock", version: "mock:none:mock" };
  return { aiMode: "real", version: `real:${providerHost()}:${getConfiguredModel()}` };
}

export interface ResponsesCallResult {
  text: string;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * One Responses API call with `store: false`. Drops parameters a model rejects
 * (as the original private-support client did); never retries other failures.
 */
export async function callResponsesApi(options: {
  system: string;
  user: string;
  maxOutputTokens: number;
  timeoutMs?: number;
}): Promise<ResponsesCallResult> {
  const apiKey = readApiKey();
  if (!apiKey) throw new Error("No AI provider is configured");

  // Any OpenAI-compatible provider (OpenRouter, Gemini, Groq) works via OPENAI_BASE_URL.
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const client = new OpenAI({
    apiKey,
    baseURL,
    ...(options.timeoutMs ? { timeout: options.timeoutMs, maxRetries: 0 } : {}),
  });
  const model = getConfiguredModel();
  const start = Date.now();

  const params: { max_output_tokens?: number; reasoning?: { effort: "none" } } = {
    max_output_tokens: options.maxOutputTokens,
    reasoning: { effort: "none" },
  };

  let created: Awaited<ReturnType<typeof client.responses.create>> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      created = await client.responses.create({
        model,
        instructions: options.system,
        input: options.user,
        store: false,
        ...params,
      });
      break;
    } catch (error) {
      const unsupported =
        error instanceof Error ? error.message.match(/Unsupported parameter: '([^']+)'/) : null;
      const name = unsupported?.[1];
      if (name === "max_output_tokens" || name === "reasoning") {
        delete params[name];
        continue;
      }
      throw error;
    }
  }
  if (!created || !("output_text" in created)) {
    throw new Error("The AI returned no response");
  }

  const usage = (created as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  return {
    text: created.output_text.trim(),
    model,
    latencyMs: Date.now() - start,
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
  };
}
