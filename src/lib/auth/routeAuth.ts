import { NextResponse } from "next/server";
import {
  checkParticipantToken,
  readParticipantToken,
} from "@/lib/auth/participantAuth";
import {
  conditionManager,
  type StudyAssignment,
} from "@/lib/intervention/ResearchConditionManager";
import { EligibilityError, eligibilityGuard } from "@/lib/intervention/ResearchEligibilityGuard";
import { getParticipantInSession, getSessionByCode } from "@/lib/services/sessions";

type Session = NonNullable<Awaited<ReturnType<typeof getSessionByCode>>>;
type Participant = NonNullable<Awaited<ReturnType<typeof getParticipantInSession>>>;

export interface SessionContext {
  session: Session;
  /** null for legacy (pre-V2) groups. */
  assignment: StudyAssignment | null;
}

export interface ParticipantContext extends SessionContext {
  participant: Participant;
}

type Failure = { ok: false; response: NextResponse };

export function errorResponse(error: unknown, fallback = "Request failed"): NextResponse {
  if (error instanceof EligibilityError) {
    return NextResponse.json(
      { error: error.message, code: error.code, blockers: error.blockers },
      { status: error.status }
    );
  }
  if (error && typeof error === "object" && "status" in error && error instanceof Error) {
    const status = Number((error as { status: unknown }).status);
    if (status >= 400 && status < 500) {
      return NextResponse.json({ error: error.message }, { status });
    }
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function loadSessionContext(
  code: string
): Promise<{ ok: true; ctx: SessionContext } | Failure> {
  const session = await getSessionByCode(code);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Session not found" }, { status: 404 }) };
  }
  const assignment = await conditionManager.getAssignment(session.id);
  return { ok: true, ctx: { session, assignment } };
}

export interface AuthorizeOptions {
  /** Status for a missing/unknown participant (legacy routes used 400 or 403). */
  missingStatus?: number;
  missingMessage?: string;
  /** V2: require this participant's own active consent. */
  requireConsent?: boolean;
  /** V2: require the started scenarios and membership of the frozen roster. */
  requireScenarioAccess?: boolean;
}

/**
 * Resolves the member making the request. V2 groups require the participant's
 * device token (fail closed); legacy groups keep the original id-only check.
 */
export async function authorizeParticipant(
  request: Request,
  code: string,
  participantId: unknown,
  options: AuthorizeOptions = {}
): Promise<({ ok: true } & ParticipantContext) | Failure> {
  const loaded = await loadSessionContext(code);
  if (!loaded.ok) return loaded;
  const { session, assignment } = loaded.ctx;

  const participant = await getParticipantInSession(
    session.id,
    typeof participantId === "string" ? participantId : null
  );
  if (!participant) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: options.missingMessage ?? "Join the session on this device first" },
        { status: options.missingStatus ?? 403 }
      ),
    };
  }

  const check = checkParticipantToken({
    isV2: !!assignment,
    token: readParticipantToken(request),
    storedHash: participant.authTokenHash,
  });
  if (check === "rejected") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This device is not signed in as that participant", code: "auth_failed" },
        { status: 401 }
      ),
    };
  }

  try {
    if (options.requireScenarioAccess) {
      await eligibilityGuard.assertScenarioAccess(assignment, participant.id);
    } else if (options.requireConsent) {
      await eligibilityGuard.assertCanRecordParticipantData(assignment, participant.id);
    }
  } catch (error) {
    return { ok: false, response: errorResponse(error) };
  }

  return { ok: true, session, assignment, participant };
}
