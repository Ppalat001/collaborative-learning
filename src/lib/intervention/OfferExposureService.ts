import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getPolicy, learningAwareOf } from "./policies";
import type { StudyAssignment } from "./ResearchConditionManager";
import { EligibilityError } from "./ResearchEligibilityGuard";
import { isClientExposureKind, type ExposureKind } from "./types";

/**
 * Per-member exposure of offers (policy-v2-3+). Only technically verifiable
 * steps are recorded: the server records creation, responses and expiry; a
 * client may report that it received an offer, displayed it in the visible
 * viewport of an active tab, or that the member opened or hid the indicator.
 * "Displayed" is never treated as "read". Private offers can only ever be
 * reported by their recipient.
 */

type InterventionRow = typeof schema.interventions.$inferSelect;

/** Kinds that count as evidence the member could have seen the offer. */
export const SEEN_KINDS: ExposureKind[] = ["client_displayed_in_viewport", "user_opened", "accepted", "deferred", "dismissed"];

interface RateWindow {
  startedAt: number;
  count: number;
}

const globalForRate = globalThis as typeof globalThis & { __exposureRate?: Map<string, RateWindow> };
function rateWindows(): Map<string, RateWindow> {
  globalForRate.__exposureRate ??= new Map();
  return globalForRate.__exposureRate;
}

export class OfferExposureService {
  /** Server-side record; ignored for groups on policies without exposure tracking. */
  recordServer(row: InterventionRow, participantIds: string[], kind: ExposureKind, now: string) {
    if (!learningAwareOf(getPolicy(row.policyVersion))) return;
    for (const participantId of participantIds) {
      db.insert(schema.offerExposures)
        .values({
          sessionId: row.sessionId,
          interventionId: row.id,
          participantId,
          scenarioOrder: row.scenarioOrder,
          kind,
          source: "server",
          serverAt: now,
          policyVersion: row.policyVersion,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  /** Who could have seen the offer before it expired; expiry is never counted as a refusal. */
  recordExpiry(row: InterventionRow, participantIds: string[], now: string) {
    if (!learningAwareOf(getPolicy(row.policyVersion))) return;
    const recipients = row.scope === "individual" && row.recipientParticipantId ? [row.recipientParticipantId] : participantIds;
    for (const participantId of recipients) {
      this.recordServer(row, [participantId], this.wasSeenBy(row.id, participantId) ? "expired_seen" : "expired_unseen", now);
    }
  }

  wasSeenBy(interventionId: string, participantId: string): boolean {
    return !!db
      .select({ id: schema.offerExposures.id })
      .from(schema.offerExposures)
      .where(
        and(
          eq(schema.offerExposures.interventionId, interventionId),
          eq(schema.offerExposures.participantId, participantId),
          inArray(schema.offerExposures.kind, SEEN_KINDS)
        )
      )
      .get();
  }

  /** Members with any evidence of having seen the offer. */
  seenBy(interventionId: string): string[] {
    return [
      ...new Set(
        db
          .select({ participantId: schema.offerExposures.participantId })
          .from(schema.offerExposures)
          .where(
            and(eq(schema.offerExposures.interventionId, interventionId), inArray(schema.offerExposures.kind, SEEN_KINDS))
          )
          .all()
          .map((r) => r.participantId)
      ),
    ];
  }

  /**
   * A client report from an authenticated, consented roster member. Rejects other
   * members' private offers (as not found), unknown kinds, finished scenarios and
   * floods; keeps the client clock only when it is plausible.
   */
  recordClient(input: {
    assignment: StudyAssignment;
    sessionId: string;
    participantId: string;
    interventionId: string;
    kind: unknown;
    clientAt: unknown;
    now: string;
  }): { recorded: boolean; duplicate: boolean } {
    const la = learningAwareOf(getPolicy(input.assignment.interventionPolicyVersion));
    if (!la) throw new EligibilityError("Exposure tracking is not part of this group's policy", "not_in_policy", 409);
    if (!isClientExposureKind(input.kind)) throw new EligibilityError("Unknown exposure kind", "invalid_kind", 400);
    const kind = input.kind;
    const row = db
      .select()
      .from(schema.interventions)
      .where(and(eq(schema.interventions.id, input.interventionId), eq(schema.interventions.sessionId, input.sessionId)))
      .get();
    if (!row || (row.scope === "individual" && row.recipientParticipantId !== input.participantId)) {
      throw new EligibilityError("Suggestion not found", "not_found", 404);
    }
    if (kind === "indicator_dismissed" && row.scope !== "group") {
      throw new EligibilityError("Only group suggestions have an indicator", "invalid_kind", 400);
    }
    if (["expired", "dismissed", "failed"].includes(row.status)) {
      throw new EligibilityError("This suggestion is closed", "offer_closed", 409);
    }
    const attempt = db
      .select({ submitted: schema.scenarioAttempts.submitted })
      .from(schema.scenarioAttempts)
      .where(eq(schema.scenarioAttempts.id, row.attemptId))
      .get();
    if (attempt?.submitted) throw new EligibilityError("This scenario is finished", "scenario_submitted", 409);

    this.checkRate(input.participantId, la.exposure.maxEventsPerMinute, Date.parse(input.now));

    let clientAt: string | null = null;
    let clientClockRejected = false;
    if (input.clientAt !== undefined && input.clientAt !== null) {
      const parsed = typeof input.clientAt === "string" ? Date.parse(input.clientAt) : NaN;
      const skew = Math.abs(parsed - Date.parse(input.now));
      const beforeCreation = parsed < Date.parse(row.createdAt) - la.exposure.maxClientClockSkewSeconds * 1000;
      if (Number.isFinite(parsed) && skew <= la.exposure.maxClientClockSkewSeconds * 1000 && !beforeCreation) {
        clientAt = new Date(parsed).toISOString();
      } else {
        clientClockRejected = true;
      }
    }
    const result = db
      .insert(schema.offerExposures)
      .values({
        sessionId: row.sessionId,
        interventionId: row.id,
        participantId: input.participantId,
        scenarioOrder: row.scenarioOrder,
        kind,
        source: "client",
        clientAt,
        clientClockRejected,
        serverAt: input.now,
        policyVersion: row.policyVersion,
      })
      .onConflictDoNothing()
      .run();
    return { recorded: result.changes === 1, duplicate: result.changes === 0 };
  }

  private checkRate(participantId: string, maxPerMinute: number, now: number) {
    const windows = rateWindows();
    const current = windows.get(participantId);
    if (!current || now - current.startedAt >= 60_000) {
      windows.set(participantId, { startedAt: now, count: 1 });
      return;
    }
    current.count++;
    if (current.count > maxPerMinute) throw new EligibilityError("Too many updates; please slow down", "too_fast", 429);
  }

  listFor(sessionId: string) {
    return db.select().from(schema.offerExposures).where(eq(schema.offerExposures.sessionId, sessionId)).all();
  }
}

export const exposureService = new OfferExposureService();

/** Tests: forget the in-memory rate windows. */
export function resetExposureRateLimits() {
  rateWindows().clear();
}
