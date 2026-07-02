import { NextResponse } from "next/server";
import { createSession } from "@/lib/services/sessions";

export async function POST() {
  try {
    const session = await createSession();
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
