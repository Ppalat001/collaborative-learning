import type { CheckpointView, InterventionView, SharedIdeaView } from "@/lib/intervention/types";
import type { DiscussionMessage } from "@/lib/types";

/**
 * The Step 1 group chat as one chronological list, built from separate stores:
 * human messages (discussion_messages, the only rows that count as chat),
 * group AI items (interventions with scope "group"), shared private excerpts
 * (ai_sharing_events) and non-AI discussion prompts (checkpoints). Nothing is
 * copied between tables; this is a read model shared by the server route and
 * the client, so both order events the same way.
 */

export type GroupTimelineKind =
  | "human_message"
  | "group_ai_message"
  | "group_ai_offer"
  | "shared_ai_excerpt"
  | "discussion_prompt";

interface EventBase {
  /** Stable across reloads: source table + row id. */
  key: string;
  /** Server time the event takes its place in the chat (sort key). */
  at: string;
  /** Server time the underlying row was created. */
  createdAt: string;
  scenarioOrder: number;
  visibility: "group";
}

export type GroupTimelineEvent =
  | (EventBase & { kind: "human_message"; message: DiscussionMessage })
  | (EventBase & { kind: "group_ai_message" | "group_ai_offer"; item: InterventionView })
  | (EventBase & { kind: "shared_ai_excerpt"; excerpt: SharedIdeaView })
  | (EventBase & { kind: "discussion_prompt"; prompt: CheckpointView });

/** A manual request is a message from the start; a proactive offer becomes one once someone accepts it. */
export function groupAiKind(item: InterventionView): "group_ai_message" | "group_ai_offer" {
  if (item.initiatedBy === "participant") return "group_ai_message";
  return item.status === "accepted" || item.status === "delivered" || item.status === "failed"
    ? "group_ai_message"
    : "group_ai_offer";
}

/** Replies sit where they were requested or accepted, so they appear at the bottom when that happens. */
function groupAiAt(item: InterventionView): string {
  return groupAiKind(item) === "group_ai_message" ? (item.acceptedAt ?? item.createdAt) : item.createdAt;
}

export function buildGroupTimeline(input: {
  scenarioOrder: number;
  messages: DiscussionMessage[];
  groupItems: InterventionView[];
  sharedIdeas: SharedIdeaView[];
  prompts?: CheckpointView[];
}): GroupTimelineEvent[] {
  const base = { scenarioOrder: input.scenarioOrder, visibility: "group" as const };
  const events = new Map<string, GroupTimelineEvent>();
  const add = (event: GroupTimelineEvent) => events.set(event.key, event);

  for (const message of input.messages) {
    const at = message.createdAt;
    add({ ...base, key: `message:${message.id}`, kind: "human_message", at, createdAt: at, message });
  }
  for (const item of input.groupItems) {
    // Private items never belong in the group chat, whatever a caller passes in.
    if (item.scope !== "group" || item.scenarioOrder !== base.scenarioOrder) continue;
    add({ ...base, key: `intervention:${item.id}`, kind: groupAiKind(item), at: groupAiAt(item), createdAt: item.createdAt, item });
  }
  for (const excerpt of input.sharedIdeas) {
    if (excerpt.scenarioOrder !== base.scenarioOrder) continue;
    const at = excerpt.createdAt;
    add({ ...base, key: `share:${excerpt.id}`, kind: "shared_ai_excerpt", at, createdAt: at, excerpt });
  }
  for (const prompt of input.prompts ?? []) {
    if (prompt.scenarioOrder !== base.scenarioOrder) continue;
    const at = prompt.createdAt;
    add({ ...base, key: `checkpoint:${prompt.id}`, kind: "discussion_prompt", at, createdAt: at, prompt });
  }
  return [...events.values()].sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));
}
