import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { GroupAIFacilitator, type GeneratedSupport, type FacilitatorRequest } from "@/lib/ai/GroupAIFacilitator";
import { InterventionOrchestrator } from "@/lib/intervention/InterventionOrchestrator";
import { getPolicy, type InterventionPolicy } from "@/lib/intervention/policies";
import { registerPresence } from "@/lib/intervention/presence";
import {
  conditionManager,
  ResearchConditionManager,
  STUDY_PROTOCOL,
  type StudyAssignment,
} from "@/lib/intervention/ResearchConditionManager";
import { eligibilityGuard } from "@/lib/intervention/ResearchEligibilityGuard";
import type { CollaborationSnapshot, ResearchCondition, StudyFeatures } from "@/lib/intervention/types";
import { recordParticipantConsent } from "@/lib/services/studyV2";
import { createSession, getOrCreateAttempt, joinSession, saveAssessment } from "@/lib/services/sessions";

export const TEST_POLICY = "policy-v2-test-accelerated";
export const CONSENT_IDS = STUDY_PROTOCOL.consent.checkboxes.map((c) => c.id);

export const V2_TEST_ENV = {
  ADAPTIVE_V2_ENABLED: "true",
  ADAPTIVE_V2_ALLOW_TEST_POLICY: "true",
};

export function testPolicy(overrides: Partial<InterventionPolicy> = {}): InterventionPolicy {
  return { ...getPolicy(TEST_POLICY), ...overrides };
}

type Session = typeof schema.sessions.$inferSelect;
type Participant = typeof schema.participants.$inferSelect;

export interface TestMember {
  participant: Participant;
  token: string;
}

export interface TestGroup {
  session: Session;
  assignment: StudyAssignment;
  members: TestMember[];
}

/** A V2 group on the accelerated test policy. */
export async function createV2Group(options: {
  condition: ResearchCondition;
  members?: number;
  start?: boolean;
  features?: Partial<StudyFeatures>;
  policyVersion?: string;
}): Promise<TestGroup> {
  const manager = new ResearchConditionManager(V2_TEST_ENV);
  const planned = manager.planAssignment({
    createdVia: "admin",
    condition: options.condition,
    policyVersion: options.policyVersion ?? TEST_POLICY,
    features: options.features,
  });
  if (!planned.ok || !planned.plan) throw new Error(planned.ok ? "no plan" : planned.error);
  const session = await createSession(planned.plan);

  const members: TestMember[] = [];
  for (let i = 0; i < (options.members ?? 2); i++) {
    const joined = await joinSession(session.code, `Member${i + 1}`);
    members.push({ participant: joined.participant, token: joined.token });
  }

  let assignment = (await conditionManager.getAssignment(session.id))!;
  if (options.start ?? true) {
    for (const member of members) {
      await recordParticipantConsent(assignment, member.participant.id, CONSENT_IDS);
      await saveAssessment(session.id, "pre", {}, {}, 0, 0, member.participant.id);
    }
    eligibilityGuard.freezeMembership(session.id, members[0].participant.id);
    assignment = (await conditionManager.getAssignment(session.id))!;
  }
  return { session, assignment, members };
}

export async function createLegacyGroup(memberCount = 2) {
  const session = await createSession(null);
  const members: TestMember[] = [];
  for (let i = 0; i < memberCount; i++) {
    const joined = await joinSession(session.code, `Legacy${i + 1}`);
    members.push({ participant: joined.participant, token: joined.token });
  }
  return { session, members };
}

export function setOnline(group: TestGroup, memberIndexes: number[], at: Date, scenarioOrder = 1) {
  for (const index of memberIndexes) {
    const member = group.members[index];
    registerPresence(
      { sessionId: group.session.id, sessionCode: group.session.code, scenarioOrder },
      `socket-${member.participant.id}`,
      member.participant.id,
      at.toISOString()
    );
  }
}

export async function say(group: TestGroup, memberIndex: number, text: string, at: Date, scenarioOrder = 1) {
  await getOrCreateAttempt(group.session.id, scenarioOrder);
  const [row] = await db
    .insert(schema.discussionMessages)
    .values({
      sessionId: group.session.id,
      participantId: group.members[memberIndex].participant.id,
      scenarioOrder,
      text,
      createdAt: at.toISOString(),
    })
    .returning();
  return row;
}

/** A controllable clock for the orchestrator. */
export class TestClock {
  constructor(public current: Date = new Date()) {}
  now = () => this.current;
  advance(seconds: number) {
    this.current = new Date(this.current.getTime() + seconds * 1000);
    return this.current;
  }
}

/** Counts generation calls; behaves like the mock facilitator otherwise. */
export class CountingFacilitator extends GroupAIFacilitator {
  calls = 0;
  constructor() {
    super(
      async () => {
        throw new Error("no real provider in tests");
      },
      () => false
    );
  }
  override async generateProcessSupport(request: FacilitatorRequest): Promise<GeneratedSupport> {
    this.calls++;
    return super.generateProcessSupport(request);
  }
}

export function makeOrchestrator(clock: TestClock) {
  const facilitator = new CountingFacilitator();
  const orchestrator = new InterventionOrchestrator({ clock: clock.now, facilitator });
  return { orchestrator, facilitator };
}

export function interventionRows(sessionId: string) {
  return db.select().from(schema.interventions).where(eq(schema.interventions.sessionId, sessionId)).all();
}

export function evaluationRows(sessionId: string) {
  return db
    .select()
    .from(schema.interventionEvaluations)
    .where(eq(schema.interventionEvaluations.sessionId, sessionId))
    .all();
}

export function feedbackRows(interventionId: string) {
  return db
    .select()
    .from(schema.interventionFeedback)
    .where(eq(schema.interventionFeedback.interventionId, interventionId))
    .all();
}

export function attemptFor(sessionId: string, scenarioOrder = 1) {
  return db
    .select()
    .from(schema.scenarioAttempts)
    .where(and(eq(schema.scenarioAttempts.sessionId, sessionId), eq(schema.scenarioAttempts.scenarioOrder, scenarioOrder)))
    .get();
}

/** In-memory snapshot for the pure monitor / decision-engine tests. */
export function makeSnapshot(overrides: Partial<CollaborationSnapshot> = {}): CollaborationSnapshot {
  return {
    sessionId: "s1",
    scenarioAttemptId: "a1",
    scenarioOrder: 1,
    condition: "proactive_group",
    activeParticipantIds: ["p1", "p2", "p3"],
    onlineParticipantIds: ["p1", "p2", "p3"],
    startedAt: null,
    discussion: [],
    groupAnswer: "",
    submitted: false,
    previousInterventions: [],
    privateOptInParticipantIds: [],
    now: new Date("2026-01-01T10:00:00.000Z").toISOString(),
    ...overrides,
  };
}

export function isoAt(base: string, secondsOffset: number): string {
  return new Date(Date.parse(base) + secondsOffset * 1000).toISOString();
}

/** Builds a request for calling a route handler directly. */
export function apiRequest(
  url: string,
  options: { method?: string; token?: string | null; body?: unknown } = {}
): Request {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers["x-participant-token"] = options.token;
  return new Request(`http://localhost${url}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

export function routeParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}
