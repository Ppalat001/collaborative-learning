import { NextResponse } from "next/server";
import { setSessionConsent } from "@/lib/services/sessions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const session = await setSessionConsent(code);
    return NextResponse.json({ consentGiven: session.consentGiven });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record consent";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
