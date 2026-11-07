import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { StudyAssignment } from "@/lib/intervention/ResearchConditionManager";
import { nowIso } from "@/lib/utils/dates";

type Participant = typeof schema.participants.$inferSelect;
type Consent = typeof schema.participantConsents.$inferSelect;

export class EligibilityError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly blockers: string[] = []
  ) {
    super(message);
  }
}

export interface MemberReadiness {
  id: string;
  name: string;
  consented: boolean;
  withdrawn: boolean;
  droppedOut: boolean;
  preTestCompleted: boolean;
  inFrozenRoster: boolean;
}

export interface ReadinessStatus {
  minGroupSize: number;
  maxGroupSize: number;
  /** Members who have not withdrawn. */
  activeMemberCount: number;
  sizeOk: boolean;
  allConsented: boolean;
  allPreTested: boolean;
  started: boolean;
  startedAt: string | null;
  canStart: boolean;
  blockers: string[];
  members: MemberReadiness[];
}

export function consentIsActive(consent: Consent | undefined): boolean {
  return !!consent && !consent.withdrawnAt && !consent.droppedOutAt;
}

/** Pure readiness computation shared by the lobby, the start gate and tests. */
export function computeReadiness(input: {
  assignment: Pick<
    StudyAssignment,
    "minGroupSize" | "maxGroupSize" | "rosterFrozenAt" | "frozenRosterIds"
  >;
  members: Pick<Participant, "id" | "displayName">[];
  consents: Pick<Consent, "participantId" | "withdrawnAt" | "droppedOutAt">[];
  preTestParticipantIds: string[];
}): ReadinessStatus {
  const { assignment, members, consents, preTestParticipantIds } = input;
  const consentBy = new Map(consents.map((c) => [c.participantId, c]));
  const frozen = new Set(assignment.frozenRosterIds ?? []);
  const rows: MemberReadiness[] = members.map((m) => {
    const consent = consentBy.get(m.id);
    return {
      id: m.id,
      name: m.displayName,
      consented: !!consent && !consent.withdrawnAt,
      withdrawn: !!consent?.withdrawnAt,
      droppedOut: !!consent?.droppedOutAt,
      preTestCompleted: preTestParticipantIds.includes(m.id),
      inFrozenRoster: frozen.has(m.id),
    };
  });

  const active = rows.filter((m) => !m.withdrawn);
  const blockers: string[] = [];
  const sizeOk =
    active.length >= assignment.minGroupSize && active.length <= assignment.maxGroupSize;
  if (active.length < assignment.minGroupSize) {
    blockers.push(
      `At least ${assignment.minGroupSize} members are needed (currently ${active.length}).`
    );
  }
  if (active.length > assignment.maxGroupSize) {
    blockers.push(`At most ${assignment.maxGroupSize} members can take part.`);
  }
  for (const member of active) {
    if (!member.consented) blockers.push(`${member.name} has not given consent yet.`);
    else if (!member.preTestCompleted) blockers.push(`${member.name} has not finished the pre-test.`);
  }
  const allConsented = active.length > 0 && active.every((m) => m.consented);
  const allPreTested = active.length > 0 && active.every((m) => m.preTestCompleted);
  const started = !!assignment.rosterFrozenAt;

  return {
    minGroupSize: assignment.minGroupSize,
    maxGroupSize: assignment.maxGroupSize,
    activeMemberCount: active.length,
    sizeOk,
    allConsented,
    allPreTested,
    started,
    startedAt: assignment.rosterFrozenAt ?? null,
    canStart: started || (sizeOk && allConsented && allPreTested),
    blockers: started ? [] : blockers,
    members: rows,
  };
}

export class ResearchEligibilityGuard {
  async getAssignment(sessionId: string): Promise<StudyAssignment | null> {
    const [row] = await db
      .select()
      .from(schema.studyAssignments)
      .where(eq(schema.studyAssignments.sessionId, sessionId))
      .limit(1);
    return row ?? null;
  }

  async getConsents(sessionId: string): Promise<Consent[]> {
    return db
      .select()
      .from(schema.participantConsents)
      .where(eq(schema.participantConsents.sessionId, sessionId));
  }

  async getConsent(participantId: string): Promise<Consent | null> {
    const [row] = await db
      .select()
      .from(schema.participantConsents)
      .where(eq(schema.participantConsents.participantId, participantId))
      .limit(1);
    return row ?? null;
  }

  async getReadinessStatus(sessionId: string, assignment?: StudyAssignment | null) {
    const resolved = assignment ?? (await this.getAssignment(sessionId));
    if (!resolved) return null;
    const [members, consents, preTests] = await Promise.all([
      db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.sessionId, sessionId))
        .orderBy(asc(schema.participants.joinedAt)),
      this.getConsents(sessionId),
      db
        .select({ participantId: schema.assessments.participantId })
        .from(schema.assessments)
        .where(
          and(
            eq(schema.assessments.sessionId, sessionId),
            eq(schema.assessments.assessmentType, "pre")
          )
        ),
    ]);
    return computeReadiness({
      assignment: resolved,
      members,
      consents,
      preTestParticipantIds: preTests.flatMap((t) => (t.participantId ? [t.participantId] : [])),
    });
  }

  async assertMemberOfSession(sessionId: string, participantId: string | null | undefined) {
    if (!participantId) throw new EligibilityError("Not a member of this group", "not_member", 403);
    const [member] = await db
      .select()
      .from(schema.participants)
      .where(
        and(eq(schema.participants.id, participantId), eq(schema.participants.sessionId, sessionId))
      )
      .limit(1);
    if (!member) throw new EligibilityError("Not a member of this group", "not_member", 403);
    return member;
  }

  /** V2 groups: no participant data is recorded before that participant's own consent. */
  async assertCanRecordParticipantData(
    assignment: StudyAssignment | null,
    participantId: string
  ): Promise<void> {
    if (!assignment) return;
    const consent = await this.getConsent(participantId);
    if (!consent || consent.sessionId !== assignment.sessionId) {
      throw new EligibilityError("Give your own consent in the lobby first", "consent_required", 403);
    }
    if (consent.withdrawnAt) {
      throw new EligibilityError("You withdrew your consent, so nothing more is recorded", "withdrawn", 403);
    }
    if (consent.droppedOutAt) {
      throw new EligibilityError("You were recorded as having left this group", "dropped_out", 403);
    }
  }

  /** V2 groups: scenarios only after the server-side start, and only for the frozen roster. */
  async assertScenarioAccess(assignment: StudyAssignment | null, participantId: string) {
    if (!assignment) return;
    if (!assignment.rosterFrozenAt) {
      throw new EligibilityError(
        "Your group has not started the scenarios yet. Start from the lobby.",
        "not_started",
        409
      );
    }
    if (!(assignment.frozenRosterIds ?? []).includes(participantId)) {
      throw new EligibilityError("You are not part of this group's study roster", "not_in_roster", 403);
    }
    await this.assertCanRecordParticipantData(assignment, participantId);
  }

  async assertCanStartScenarios(sessionId: string) {
    const status = await this.getReadinessStatus(sessionId);
    if (!status) throw new EligibilityError("Not a V2 group", "not_v2", 400);
    if (!status.canStart) {
      throw new EligibilityError("The group cannot start yet", "not_ready", 409, status.blockers);
    }
    return status;
  }

  /**
   * Re-checks every condition and freezes the roster in one transaction, so a
   * join or withdrawal racing with the start cannot slip in. Idempotent.
   */
  freezeMembership(sessionId: string, startedBy: string): { startedAt: string; roster: string[]; alreadyStarted: boolean } {
    return db.transaction((tx) => {
      const assignment = tx
        .select()
        .from(schema.studyAssignments)
        .where(eq(schema.studyAssignments.sessionId, sessionId))
        .get();
      if (!assignment) throw new EligibilityError("Not a V2 group", "not_v2", 400);
      if (assignment.rosterFrozenAt) {
        return {
          startedAt: assignment.rosterFrozenAt,
          roster: assignment.frozenRosterIds ?? [],
          alreadyStarted: true,
        };
      }
      const members = tx
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.sessionId, sessionId))
        .orderBy(asc(schema.participants.joinedAt))
        .all();
      const consents = tx
        .select()
        .from(schema.participantConsents)
        .where(eq(schema.participantConsents.sessionId, sessionId))
        .all();
      const preTests = tx
        .select({ participantId: schema.assessments.participantId })
        .from(schema.assessments)
        .where(
          and(
            eq(schema.assessments.sessionId, sessionId),
            eq(schema.assessments.assessmentType, "pre")
          )
        )
        .all();
      const status = computeReadiness({
        assignment,
        members,
        consents,
        preTestParticipantIds: preTests.flatMap((t) => (t.participantId ? [t.participantId] : [])),
      });
      if (!members.some((m) => m.id === startedBy)) {
        throw new EligibilityError("Only a group member can start", "not_member", 403);
      }
      if (!status.canStart) {
        throw new EligibilityError("The group cannot start yet", "not_ready", 409, status.blockers);
      }
      const roster = status.members.filter((m) => !m.withdrawn).map((m) => m.id);
      const startedAt = nowIso();
      const result = tx
        .update(schema.studyAssignments)
        .set({ rosterFrozenAt: startedAt, frozenRosterIds: roster, startedBy })
        .where(
          and(
            eq(schema.studyAssignments.id, assignment.id),
            isNull(schema.studyAssignments.rosterFrozenAt)
          )
        )
        .run();
      if (result.changes !== 1) {
        throw new EligibilityError("The group was started concurrently", "conflict", 409);
      }
      return { startedAt, roster, alreadyStarted: false };
    });
  }

  /** Members whose "I am good" is required: frozen roster minus withdrawn / dropped-out members. */
  async getRequiredReadyIds(
    sessionId: string,
    assignment: StudyAssignment | null,
    allMemberIds: string[]
  ): Promise<string[]> {
    if (!assignment) return allMemberIds;
    const consents = await this.getConsents(sessionId);
    const inactive = new Set(
      consents.filter((c) => !consentIsActive(c)).map((c) => c.participantId)
    );
    const roster = assignment.rosterFrozenAt ? (assignment.frozenRosterIds ?? []) : allMemberIds;
    return roster.filter((id) => !inactive.has(id));
  }
}

export const eligibilityGuard = new ResearchEligibilityGuard();
