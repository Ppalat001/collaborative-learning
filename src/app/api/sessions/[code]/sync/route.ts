import { NextResponse } from "next/server";
import {
  getParticipantInSession,
  getSessionByCode,
  updateAttemptFields,
  type EditBatch,
} from "@/lib/services/sessions";
import { getRoomState } from "@/lib/socket";
import { SHARED_FIELDS, isSharedField, type SharedField } from "@/lib/instruments";
import type { AuthorRun } from "@/lib/types";

const MAX_INSERTED_TEXT = 5000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const { searchParams } = new URL(request.url);
    const scenarioOrder = Number(searchParams.get("scenarioOrder") ?? "1");
    const session = await getSessionByCode(code);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const roomState = getRoomState(code, scenarioOrder);
    return NextResponse.json({ roomState });
  } catch (error) {
    console.error("Sync GET error:", error);
    return NextResponse.json({ error: "Failed to sync" }, { status: 500 });
  }
}

function parseFields(source: Record<string, unknown>) {
  const fields: Partial<Record<SharedField, string>> = {};
  for (const field of SHARED_FIELDS) {
    if (typeof source[field] === "string") fields[field] = source[field] as string;
  }
  return fields;
}

function parseEdits(value: unknown): EditBatch[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((edit) => edit && isSharedField(String(edit.field)))
    .map((edit) => ({
      field: edit.field as SharedField,
      charsAdded: Math.max(0, Math.floor(Number(edit.charsAdded) || 0)),
      charsRemoved: Math.max(0, Math.floor(Number(edit.charsRemoved) || 0)),
      insertedText: String(edit.insertedText ?? "").slice(0, MAX_INSERTED_TEXT),
    }));
}

function parseAuthorship(value: unknown): AuthorRun[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((run) => ({
    participantId: typeof run?.participantId === "string" ? run.participantId : null,
    length: Math.max(0, Math.floor(Number(run?.length) || 0)),
  }));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await request.json();
    const scenarioOrder = Number(body.scenarioOrder ?? 1);

    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const participant = await getParticipantInSession(session.id, body.participantId);
    const fields = parseFields(body.fields ?? body);
    const edits = parseEdits(body.edits);

    const result = await updateAttemptFields(
      session.id,
      scenarioOrder,
      fields,
      parseAuthorship(body.authorship),
      edits,
      participant?.id ?? null
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Sync POST error:", error);
    return NextResponse.json({ error: "Failed to sync" }, { status: 500 });
  }
}
