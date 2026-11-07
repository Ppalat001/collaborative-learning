import { NextResponse } from "next/server";
import { conditionManager } from "@/lib/intervention/ResearchConditionManager";
import { createSession } from "@/lib/services/sessions";

export async function POST() {
  try {
    // Home-page groups are V2 unless ADAPTIVE_V2_ENABLED=false or ADAPTIVE_V2_HOME_PAGE_GROUPS=legacy.
    const planned = conditionManager.planAssignment({ createdVia: "home_page" });
    if (!planned.ok) {
      console.error("V2 group configuration rejected:", planned.error);
      return NextResponse.json(
        { error: "New groups cannot be created right now. Please tell the researcher." },
        { status: 503 }
      );
    }
    const session = await createSession(planned.plan);
    return NextResponse.json({
      code: session.code,
      id: session.id,
    });
  } catch (error) {
    console.error("Failed to create session:", error);
    return NextResponse.json(
      { error: "Failed to create session. Is the database running?" },
      { status: 500 }
    );
  }
}
