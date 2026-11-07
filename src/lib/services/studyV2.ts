import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  STUDY_PROTOCOL,
  capabilitiesFor,
  conditionOf,
  type StudyAssignment,
} from "@/lib/intervention/ResearchConditionManager";
import { EligibilityError, eligibilityGuard } from "@/lib/intervention/ResearchEligibilityGuard";
import { nowIso } from "@/lib/utils/dates";
import { logResearchEvent } from "@/lib/utils/export";

const CONSENT_STATEMENT_IDS = STUDY_PROTOCOL.consent.checkboxes.map((c) => c.id);
const NOTE_MAX_LENGTH = 1000;

/**
 * Records one participant's own consent. Every statement in the approved form
 * must be confirmed; nobody can consent for another member.
 */
export async function recordParticipantConsent(
  assignment: StudyAssignment,
  participantId: string,
  confirmedStatements: unknown
) {
  if (STUDY_PROTOCOL.consent.version !== assignment.consentVersion) {
    throw new EligibilityError(
      "The consent text for this group's version is no longer available; contact the researcher",
      "consent_version_unavailable",
      409
    );
  }
  const confirmed = Array.isArray(confirmedStatements)
    ? confirmedStatements.filter((id): id is string => typeof id === "string")
    : [];
  const missing = CONSENT_STATEMENT_IDS.filter((id) => !confirmed.includes(id));
  if (missing.length > 0) {
    throw new EligibilityError("Please confirm every statement to give consent", "consent_incomplete", 400);
  }
  if (assignment.rosterFrozenAt && !(assignment.frozenRosterIds ?? []).includes(participantId)) {
    throw new EligibilityError("This group has already started", "roster_frozen", 409);
  }

  const existing = await eligibilityGuard.getConsent(participantId);
  if (existing?.withdrawnAt) {
    throw new EligibilityError(
      "You withdrew your consent. Please contact the researcher if you want to take part again.",
      "withdrawn",
      409
    );
  }
  if (existing) return existing;

  await db
    .insert(schema.participantConsents)
    .values({
      sessionId: assignment.sessionId,
      participantId,
      consentVersion: assignment.consentVersion,
      informationSheetVersion: assignment.informationSheetVersion,
      confirmedStatements: CONSENT_STATEMENT_IDS,
      aiProcessingAcknowledged: confirmed.includes("ai_processing"),
    })
    .onConflictDoNothing();
  const consent = await eligibilityGuard.getConsent(participantId);
  if (!consent) throw new Error("Failed to record consent");
  await logResearchEvent(
    assignment.sessionId,
    "participant_consent_given",
    { consentVersion: consent.consentVersion, informationSheetVersion: consent.informationSheetVersion },
    participantId
  );
  return consent;
}

/** Withdrawal is recorded, never a deletion; later data capture is refused. */
export async function withdrawParticipantConsent(
  assignment: StudyAssignment,
  participantId: string,
  note: unknown
) {
  const consent = await eligibilityGuard.getConsent(participantId);
  if (!consent) {
    throw new EligibilityError("There is no consent to withdraw", "no_consent", 400);
  }
  if (consent.withdrawnAt) return consent;
  const [updated] = await db
    .update(schema.participantConsents)
    .set({
      withdrawnAt: nowIso(),
      withdrawalNote: typeof note === "string" ? note.trim().slice(0, NOTE_MAX_LENGTH) || null : null,
    })
    .where(eq(schema.participantConsents.id, consent.id))
    .returning();
  await logResearchEvent(assignment.sessionId, "participant_consent_withdrawn", undefined, participantId);
  return updated;
}

/**
 * Researcher action for a member who left a started group for good: they stop
 * counting for "I am good" so the others can finish. Recorded, not deleted.
 */
export async function markParticipantDroppedOut(
  sessionId: string,
  participantId: string,
  note: unknown
) {
  const [consent] = await db
    .select()
    .from(schema.participantConsents)
    .where(
      and(
        eq(schema.participantConsents.sessionId, sessionId),
        eq(schema.participantConsents.participantId, participantId)
      )
    )
    .limit(1);
  if (!consent) throw new EligibilityError("That member has no consent record", "no_consent", 400);
  if (consent.droppedOutAt) return consent;
  const [updated] = await db
    .update(schema.participantConsents)
    .set({
      droppedOutAt: nowIso(),
      dropOutNote: typeof note === "string" ? note.trim().slice(0, NOTE_MAX_LENGTH) || null : null,
    })
    .where(eq(schema.participantConsents.id, consent.id))
    .returning();
  await logResearchEvent(sessionId, "participant_marked_dropped_out", { recordedBy: "researcher" }, participantId);
  return updated;
}

/** What members of a V2 group may know about the design (no thresholds, no other members' data). */
export function publicStudyInfo(assignment: StudyAssignment) {
  const condition = conditionOf(assignment);
  const disclosure = STUDY_PROTOCOL.conditionDisclosure as Record<string, string>;
  return {
    condition,
    conditionDescription: disclosure[condition] ?? "",
    capabilities: capabilitiesFor(condition),
    features: assignment.features,
    minGroupSize: assignment.minGroupSize,
    maxGroupSize: assignment.maxGroupSize,
    started: !!assignment.rosterFrozenAt,
    startedAt: assignment.rosterFrozenAt,
    consent: {
      version: assignment.consentVersion,
      informationSheetVersion: assignment.informationSheetVersion,
    },
  };
}

/** The consent form for this group's recorded version (only the current version's text ships). */
export function consentDocument(assignment: StudyAssignment) {
  const doc = STUDY_PROTOCOL.consent;
  return {
    version: assignment.consentVersion,
    informationSheetVersion: assignment.informationSheetVersion,
    textAvailable: doc.version === assignment.consentVersion,
    title: doc.title,
    paragraphs: doc.paragraphs,
    checkboxes: doc.checkboxes,
    contact: doc.contact,
    withdrawal: doc.withdrawal,
    draft: STUDY_PROTOCOL.status.startsWith("DRAFT"),
  };
}
