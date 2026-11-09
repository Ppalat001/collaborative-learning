import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { buildGroupTimeline, type GroupTimelineEvent } from "@/lib/groupTimeline";
import { exposureService } from "@/lib/intervention/OfferExposureService";
import { getPolicy } from "@/lib/intervention/policies";
import { capabilitiesFor, conditionOf, type StudyAssignment } from "@/lib/intervention/ResearchConditionManager";
import {
  expireStaleOffers,
  getActiveRosterIds,
  listCheckpointViews,
  listSharedIdeas,
  listVisibleInterventions,
} from "@/lib/services/interventions";
import { getDiscussionMessages } from "@/lib/services/sessions";

type Session = typeof schema.sessions.$inferSelect;

/**
 * The Step 1 chat for one authorized viewer: human messages, group AI replies
 * and offers (with this viewer's own hide/"not now" state), and shared private
 * excerpts. Private interventions are excluded by the query and again by the
 * builder; the caller must already have checked the viewer's roster access.
 */
export async function getGroupTimeline(input: {
  session: Session;
  assignment: StudyAssignment;
  scenarioOrder: number;
  viewerId: string;
}): Promise<GroupTimelineEvent[]> {
  const { session, assignment, scenarioOrder, viewerId } = input;
  const policy = getPolicy(assignment.interventionPolicyVersion);
  const capabilities = capabilitiesFor(conditionOf(assignment));
  const attempt = db
    .select()
    .from(schema.scenarioAttempts)
    .where(and(eq(schema.scenarioAttempts.sessionId, session.id), eq(schema.scenarioAttempts.scenarioOrder, scenarioOrder)))
    .get();
  if (attempt) {
    const now = new Date().toISOString();
    for (const row of expireStaleOffers(attempt.id, now)) {
      exposureService.recordExpiry(row, getActiveRosterIds(assignment), now);
    }
  }
  const groupItems = attempt
    ? listVisibleInterventions(attempt.id, viewerId, session.id, policy.deferSeconds).filter((i) => i.scope === "group")
    : [];
  return buildGroupTimeline({
    scenarioOrder,
    messages: await getDiscussionMessages(session.id, scenarioOrder),
    groupItems,
    sharedIdeas: capabilities.sharing ? listSharedIdeas(session.id, scenarioOrder) : [],
    prompts: assignment.features.checkpoints ? await listCheckpointViews(session.id, scenarioOrder) : [],
  });
}
