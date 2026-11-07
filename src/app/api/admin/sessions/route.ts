import { NextResponse } from "next/server";
import {
  conditionManager,
  type AssignmentRequest,
} from "@/lib/intervention/ResearchConditionManager";
import { isResearchCondition } from "@/lib/intervention/types";
import {
  createSession,
  deleteAllSessions,
  deleteSession,
  getSessionByCode,
  listSessionsForAdmin,
} from "@/lib/services/sessions";
import { isAdminRequest } from "@/lib/utils/admin";

const DELETE_ALL_CONFIRMATION = "DELETE ALL";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ sessions: await listSessionsForAdmin() });
  } catch (error) {
    console.error("Admin sessions error:", error);
    return NextResponse.json({ error: "Failed to load groups" }, { status: 500 });
  }
}

/**
 * Creates one Adaptive Scaffolding V2 group with an explicit condition.
 * Refused when V2 is switched off (ADAPTIVE_V2_ENABLED=false).
 */
export async function POST(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    if (body.condition !== undefined && !isResearchCondition(body.condition)) {
      return NextResponse.json({ error: "Unknown research condition" }, { status: 400 });
    }
    const assignmentRequest: AssignmentRequest = {
      createdVia: "admin",
      condition: body.condition,
      policyVersion: typeof body.policyVersion === "string" ? body.policyVersion : undefined,
      features: body.features && typeof body.features === "object" ? body.features : undefined,
    };
    const planned = conditionManager.planAssignment(assignmentRequest);
    if (!planned.ok) return NextResponse.json({ error: planned.error }, { status: 403 });
    if (!planned.plan) return NextResponse.json({ error: "Adaptive Scaffolding V2 is disabled" }, { status: 403 });
    const session = await createSession(planned.plan);
    return NextResponse.json({
      code: session.code,
      condition: planned.plan.researchCondition,
      assignmentMethod: planned.plan.assignmentMethod,
      interventionPolicyVersion: planned.plan.interventionPolicyVersion,
    });
  } catch (error) {
    console.error("Admin create group error:", error);
    return NextResponse.json({ error: "Failed to create the group" }, { status: 500 });
  }
}

/**
 * `?session=CODE` deletes one group; `?all=1` with `{ confirm: "DELETE ALL" }`
 * deletes every group. All related rows go with them.
 */
export async function DELETE(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const body = await request.json().catch(() => ({}));

    if (searchParams.get("all") === "1") {
      if (body.confirm !== DELETE_ALL_CONFIRMATION) {
        return NextResponse.json(
          { error: `Type "${DELETE_ALL_CONFIRMATION}" to confirm` },
          { status: 400 }
        );
      }
      return NextResponse.json({ deleted: await deleteAllSessions() });
    }

    const code = searchParams.get("session")?.trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ error: "Choose a group to delete" }, { status: 400 });
    }
    if (String(body.confirm ?? "").trim().toUpperCase() !== code) {
      return NextResponse.json(
        { error: `Type the group code ${code} to confirm` },
        { status: 400 }
      );
    }
    const session = await getSessionByCode(code);
    if (!session) {
      return NextResponse.json({ error: `Group ${code} not found` }, { status: 404 });
    }
    await deleteSession(session.id);
    return NextResponse.json({ deleted: 1 });
  } catch (error) {
    console.error("Admin delete error:", error);
    return NextResponse.json({ error: "Failed to delete data" }, { status: 500 });
  }
}
