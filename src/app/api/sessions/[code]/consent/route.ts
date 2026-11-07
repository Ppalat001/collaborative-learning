import { NextResponse } from "next/server";
import { authorizeParticipant, errorResponse, loadSessionContext } from "@/lib/auth/routeAuth";
import { eligibilityGuard } from "@/lib/intervention/ResearchEligibilityGuard";
import { setSessionConsent } from "@/lib/services/sessions";
import {
  consentDocument,
  recordParticipantConsent,
  withdrawParticipantConsent,
} from "@/lib/services/studyV2";

/** V2 groups: the consent form for this group's version and the caller's own status. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const loaded = await loadSessionContext(code);
  if (!loaded.ok) return loaded.response;
  const { assignment } = loaded.ctx;
  if (!assignment) return NextResponse.json({ legacy: true });

  const participantId = new URL(request.url).searchParams.get("participantId");
  let mine: { consented: boolean; withdrawn: boolean } | null = null;
  if (participantId) {
    const auth = await authorizeParticipant(request, code, participantId);
    if (!auth.ok) return auth.response;
    const consent = await eligibilityGuard.getConsent(auth.participant.id);
    mine = { consented: !!consent && !consent.withdrawnAt, withdrawn: !!consent?.withdrawnAt };
  }
  return NextResponse.json({ document: consentDocument(assignment), mine });
}

/**
 * Legacy groups: the original group-level consent flag (unchanged).
 * V2 groups: `{ participantId, confirmedStatements }` records the caller's own
 * consent; `{ action: "withdraw" }` records a withdrawal.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const loaded = await loadSessionContext(code);
    if (!loaded.ok) return loaded.response;

    if (!loaded.ctx.assignment) {
      const session = await setSessionConsent(code);
      return NextResponse.json({ consentGiven: session.consentGiven });
    }

    const body = await request.json().catch(() => ({}));
    const auth = await authorizeParticipant(request, code, body.participantId, {
      missingMessage: "Each member gives consent on their own device after joining",
    });
    if (!auth.ok) return auth.response;
    const assignment = auth.assignment!;

    if (body.action === "withdraw") {
      const consent = await withdrawParticipantConsent(assignment, auth.participant.id, body.note);
      return NextResponse.json({ withdrawn: true, withdrawnAt: consent.withdrawnAt });
    }

    const consent = await recordParticipantConsent(
      assignment,
      auth.participant.id,
      body.confirmedStatements
    );
    return NextResponse.json({
      consented: true,
      consentVersion: consent.consentVersion,
      consentedAt: consent.consentedAt,
    });
  } catch (error) {
    return errorResponse(error, "Failed to record consent");
  }
}
