import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { EligibilityError } from "@/lib/intervention/ResearchEligibilityGuard";
import type { CollaborationSnapshot } from "@/lib/intervention/types";
import type { Scenario } from "@/lib/types";

/**
 * Non-AI collaboration structure, identical in every V2 condition so conditions
 * differ only in AI behaviour: the opening prompt, optional human role cards, the
 * optional private initial idea, and member-raised checkpoint questions.
 */

export const OPENING_PROMPT_VERSION = "opening-prompt-v1";

export const ROLE_CARDS = [
  {
    id: "facilitator",
    label: "Facilitator",
    description: "Keeps the discussion moving and checks that the group answers the question.",
  },
  {
    id: "evidence_reviewer",
    label: "Evidence reviewer",
    description: "Asks what reasons or examples support each idea.",
  },
  {
    id: "alternative_perspective",
    label: "Alternative-perspective reviewer",
    description: "Raises other ways of seeing the situation before the group decides.",
  },
  {
    id: "synthesizer",
    label: "Synthesizer",
    description: "Pulls the agreed points together for the group answer.",
  },
] as const;
export type RoleId = (typeof ROLE_CARDS)[number]["id"];

export function isRoleId(value: unknown): value is RoleId {
  return ROLE_CARDS.some((role) => role.id === value);
}

export const CHECKPOINTS = {
  agreed: "What have we agreed on so far?",
  disputed: "What do we still see differently, and why?",
  evidence: "Which reasons or examples support our answer?",
  missing: "Is any part of the question not answered yet?",
} as const;
export type CheckpointKind = keyof typeof CHECKPOINTS;

export function isCheckpointKind(value: unknown): value is CheckpointKind {
  return typeof value === "string" && value in CHECKPOINTS;
}

export const INITIAL_IDEA_MAX_LENGTH = 1000;

export type DiscussionStage = "not_started" | "exploring" | "drafting" | "finalizing" | "submitted";

export interface OpeningPrompt {
  version: string;
  starterName: string | null;
  steps: string[];
}

export class GroupDiscussionCoordinator {
  /**
   * The starter rotates by scenario so the same person is not always asked to
   * open. Human members start the substantive discussion; no AI is involved.
   */
  getOpeningPrompt(scenario: Scenario, members: { id: string; name: string }[]): OpeningPrompt {
    const starter = members.length ? members[(scenario.order - 1) % members.length] : null;
    return {
      version: OPENING_PROMPT_VERSION,
      starterName: starter?.name ?? null,
      steps: [
        starter
          ? `${starter.name} is invited to start by sharing a first idea about the question above (anyone may start if they prefer).`
          : "Someone shares a first idea about the question above.",
        "Each other member adds their view, a question, or a different angle, in any order.",
        "Agree on the main points together before writing the group answer.",
      ],
    };
  }

  /** Suggested rotation: member i gets role (i + scenario - 1) mod 4. Members may pick any role or none. */
  offerRoles(memberIds: string[], scenarioOrder: number): Record<string, RoleId> {
    const suggestion: Record<string, RoleId> = {};
    memberIds.forEach((id, index) => {
      suggestion[id] = ROLE_CARDS[(index + scenarioOrder - 1) % ROLE_CARDS.length].id;
    });
    return suggestion;
  }

  async chooseRole(input: {
    sessionId: string;
    participantId: string;
    scenarioOrder: number;
    role: RoleId;
    rosterIds: string[];
  }) {
    const suggested = this.offerRoles(input.rosterIds, input.scenarioOrder)[input.participantId];
    const values = {
      sessionId: input.sessionId,
      participantId: input.participantId,
      scenarioOrder: input.scenarioOrder,
      role: input.role,
      matchesRotation: suggested === input.role,
    };
    await db
      .insert(schema.groupRoles)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.groupRoles.participantId, schema.groupRoles.scenarioOrder],
        set: { role: values.role, matchesRotation: values.matchesRotation, createdAt: new Date().toISOString() },
      });
    return values;
  }

  async listRoles(sessionId: string, scenarioOrder: number) {
    return db
      .select()
      .from(schema.groupRoles)
      .where(and(eq(schema.groupRoles.sessionId, sessionId), eq(schema.groupRoles.scenarioOrder, scenarioOrder)));
  }

  /** Written once, before AI use, as a private pre-AI baseline. Never copied into the shared answer. */
  async recordInitialIdea(input: { sessionId: string; participantId: string; scenarioOrder: number; text: string }) {
    const text = input.text.trim();
    if (!text) throw new EligibilityError("Write your idea first", "empty", 400);
    if (text.length > INITIAL_IDEA_MAX_LENGTH) {
      throw new EligibilityError(`Keep your idea under ${INITIAL_IDEA_MAX_LENGTH} characters`, "too_long", 400);
    }
    const inserted = await db
      .insert(schema.scenarioInitialIdeas)
      .values({ sessionId: input.sessionId, participantId: input.participantId, scenarioOrder: input.scenarioOrder, text })
      .onConflictDoNothing()
      .returning();
    if (inserted.length === 0) {
      throw new EligibilityError("Your initial idea for this scenario is already saved", "already_recorded", 409);
    }
    return inserted[0];
  }

  async getInitialIdea(participantId: string, scenarioOrder: number) {
    const [row] = await db
      .select()
      .from(schema.scenarioInitialIdeas)
      .where(
        and(
          eq(schema.scenarioInitialIdeas.participantId, participantId),
          eq(schema.scenarioInitialIdeas.scenarioOrder, scenarioOrder)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async raiseCheckpoint(input: { sessionId: string; participantId: string; scenarioOrder: number; kind: CheckpointKind }) {
    const [row] = await db
      .insert(schema.groupCheckpoints)
      .values(input)
      .returning();
    return row;
  }

  async listCheckpoints(sessionId: string, scenarioOrder: number) {
    return db
      .select()
      .from(schema.groupCheckpoints)
      .where(
        and(eq(schema.groupCheckpoints.sessionId, sessionId), eq(schema.groupCheckpoints.scenarioOrder, scenarioOrder))
      )
      .orderBy(asc(schema.groupCheckpoints.createdAt));
  }

  getReflectionCheckpoint(kind: CheckpointKind): string {
    return CHECKPOINTS[kind];
  }

  getDiscussionStage(snapshot: CollaborationSnapshot): DiscussionStage {
    if (snapshot.submitted) return "submitted";
    const words = snapshot.groupAnswer.trim().split(/\s+/).filter(Boolean).length;
    if (snapshot.discussion.length === 0 && words === 0) return "not_started";
    if (words === 0) return "exploring";
    if (words < 60) return "drafting";
    return "finalizing";
  }
}

export const discussionCoordinator = new GroupDiscussionCoordinator();
