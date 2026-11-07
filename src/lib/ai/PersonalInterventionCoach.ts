import { callResponsesApi, isRealAiConfigured } from "@/lib/ai/provider";
import type { GeneratedSupport, ResponsesCaller } from "@/lib/ai/GroupAIFacilitator";
import { CollaborationMonitor } from "@/lib/intervention/CollaborationMonitor";
import type { InterventionPolicy } from "@/lib/intervention/policies";
import {
  buildPrivateOfferRequest,
  getPrivateOfferTemplate,
  PRIVATE_OFFER_PROMPT_VERSION,
  TEMPLATE_VERSION,
} from "@/lib/intervention/prompts";
import type {
  CollaborationSnapshot,
  InterventionAssessment,
  PrivateOfferSupportType,
} from "@/lib/intervention/types";
import { validatePrivateOfferOutput } from "@/lib/intervention/validators";
import type { Scenario } from "@/lib/types";

/**
 * Private, opt-in help for one member (dual_adaptive only). Offers are based only
 * on that member's own explicit signals ("I'm stuck" or their own message saying
 * they are unsure), never on silence or low activity. Nothing is generated until
 * the member accepts the offer.
 */

const OFFER_TEXT: Record<PrivateOfferSupportType, string> = {
  hint: "Would you like a small hint?",
  guiding_question: "Would you like a guiding question to think about?",
  explanation: "Would you like a brief explanation of a related idea?",
};

export class PersonalInterventionCoach {
  constructor(
    private readonly call: ResponsesCaller = callResponsesApi,
    private readonly realConfigured: () => boolean = isRealAiConfigured
  ) {}

  evaluateExplicitNeed(
    participantId: string,
    snapshot: CollaborationSnapshot,
    policy: InterventionPolicy,
    source: "button" | "message"
  ): InterventionAssessment | null {
    const progress = new CollaborationMonitor(policy).isMeaningfulProgress(snapshot);
    if (source === "button") {
      return {
        trigger: "explicit_confusion",
        evidenceMessageIds: [],
        evidenceSummary: "The member pressed \"I'm stuck\".",
        confidence: 1,
        progressState: progress.state,
        source: "student_request",
        participantId,
      };
    }
    const own = new CollaborationMonitor(policy)
      .detectExplicitNeeds(snapshot)
      .find((a) => a.trigger === "explicit_confusion" && a.participantId === participantId);
    return own ?? null;
  }

  makePrivateOffer(supportType: PrivateOfferSupportType): string {
    return OFFER_TEXT[supportType];
  }

  async generatePrivateSupport(input: {
    policy: InterventionPolicy;
    scenario: Scenario;
    supportType: PrivateOfferSupportType;
    snapshot: CollaborationSnapshot;
  }): Promise<GeneratedSupport> {
    const template = getPrivateOfferTemplate(input.supportType);
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
    const prompt = buildPrivateOfferRequest({
      scenario: input.scenario,
      supportType: input.supportType,
      discussion: input.snapshot.discussion,
      limits: input.policy.facilitator,
    });
    const result = await this.call({
      system: prompt.system,
      user: prompt.user,
      maxOutputTokens: input.policy.facilitator.maxOutputTokens,
      timeoutMs: input.policy.facilitator.timeoutMs,
    });
    const valid = validatePrivateOfferOutput(result.text, input.policy.facilitator.maxOutputChars);
    return {
      content: valid.ok ? valid.value : template,
      aiOrigin: valid.ok ? "real" : "template_fallback",
      aiModel: result.model,
      promptVersion: valid.ok
        ? PRIVATE_OFFER_PROMPT_VERSION
        : `${PRIVATE_OFFER_PROMPT_VERSION}+${TEMPLATE_VERSION}`,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      note: valid.ok ? null : `model output rejected: ${valid.reason}`,
    };
  }
}

export const personalCoach = new PersonalInterventionCoach();
