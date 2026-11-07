import { callResponsesApi, isRealAiConfigured, type ResponsesCallResult } from "@/lib/ai/provider";
import type { InterventionPolicy } from "@/lib/intervention/policies";
import {
  buildFacilitatorRequest,
  FACILITATOR_PROMPT_VERSION,
  getFacilitatorTemplate,
  TEMPLATE_VERSION,
} from "@/lib/intervention/prompts";
import type { CollaborationSnapshot, GroupSupportType, InterventionDecision } from "@/lib/intervention/types";
import { validateFacilitatorOutput } from "@/lib/intervention/validators";
import type { Scenario } from "@/lib/types";

/** real = model output; mock = no API key configured; template_fallback = model output rejected. */
export type AiOrigin = "real" | "mock" | "template_fallback";

export interface GeneratedSupport {
  content: string;
  aiOrigin: AiOrigin;
  aiModel: string | null;
  promptVersion: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Why a fallback was used, if it was. */
  note: string | null;
}

export type ResponsesCaller = (options: {
  system: string;
  user: string;
  maxOutputTokens: number;
  timeoutMs?: number;
}) => Promise<ResponsesCallResult>;

export interface FacilitatorRequest {
  policy: InterventionPolicy;
  scenario: Scenario;
  supportType: GroupSupportType;
  snapshot: CollaborationSnapshot;
  /** Neutral description of why the facilitator is speaking (never names anyone). */
  situation: string;
  previousFacilitatorTexts: string[];
  memberNames: string[];
}

export class GroupAIFacilitator {
  constructor(
    private readonly call: ResponsesCaller = callResponsesApi,
    private readonly realConfigured: () => boolean = isRealAiConfigured
  ) {}

  /** The neutral situation sentence sent to the model for a proactive decision. */
  createSharedPrompt(snapshot: CollaborationSnapshot, decision: Pick<InterventionDecision, "trigger">): string {
    if (decision.trigger === "student_requested") return "A group member asked the facilitator for this.";
    const summaries: Record<string, string> = {
      initial_silence: "The group has been connected for a while and nobody has written yet.",
      stalled_discussion: "The discussion has paused for a few minutes.",
      explicit_confusion: "A member said they are unsure how to continue.",
      unresolved_disagreement: "Members disagree and have not reached agreement yet.",
      possible_participation_imbalance: "So far the discussion has come mostly from part of the group.",
      coordination_request: "A member asked how the group should organise the work.",
    };
    const minutes = snapshot.startedAt
      ? Math.max(1, Math.round((Date.parse(snapshot.now) - Date.parse(snapshot.startedAt)) / 60000))
      : null;
    const base = summaries[decision.trigger] ?? "The group may benefit from a short process prompt.";
    return minutes ? `${base} (About ${minutes} min into the scenario.)` : base;
  }

  validateOutput(text: string, memberNames: string[], policy: InterventionPolicy) {
    return validateFacilitatorOutput(text, { maxChars: policy.facilitator.maxOutputChars, memberNames });
  }

  async generateProcessSupport(request: FacilitatorRequest): Promise<GeneratedSupport> {
    const template = getFacilitatorTemplate(request.supportType, request.scenario);
    if (!this.realConfigured()) {
      return {
        content: template,
        aiOrigin: "mock",
        aiModel: "mock",
        promptVersion: TEMPLATE_VERSION,
        latencyMs: 0,
        inputTokens: null,
        outputTokens: null,
        note: null,
      };
    }

    const prompt = buildFacilitatorRequest({
      scenario: request.scenario,
      supportType: request.supportType,
      discussion: request.snapshot.discussion,
      groupAnswer: request.snapshot.groupAnswer,
      situation: request.situation,
      previousFacilitatorTexts: request.previousFacilitatorTexts,
      limits: request.policy.facilitator,
    });
    const result = await this.call({
      system: prompt.system,
      user: prompt.user,
      maxOutputTokens: request.policy.facilitator.maxOutputTokens,
      timeoutMs: request.policy.facilitator.timeoutMs,
    });
    const valid = this.validateOutput(result.text, request.memberNames, request.policy);
    return {
      content: valid.ok ? valid.value : template,
      aiOrigin: valid.ok ? "real" : "template_fallback",
      aiModel: result.model,
      promptVersion: valid.ok ? FACILITATOR_PROMPT_VERSION : `${FACILITATOR_PROMPT_VERSION}+${TEMPLATE_VERSION}`,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      note: valid.ok ? null : `model output rejected: ${valid.reason}`,
    };
  }
}

export const groupFacilitator = new GroupAIFacilitator();
