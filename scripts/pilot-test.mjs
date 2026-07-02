#!/usr/bin/env node
/**
 * Pilot validation script — simulates core research flow without a browser.
 * Run after starting the server: npm run dev
 * Then: npm run pilot:test
 */

const BASE = process.env.PILOT_BASE_URL ?? "http://localhost:3000";

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path}: ${data.error ?? res.statusText}`);
  }
  return data;
}

async function main() {
  console.log("Pilot test starting against", BASE);

  const session = await request("/api/sessions", { method: "POST" });
  console.log("Created session:", session.code);

  await request(`/api/sessions/${session.code}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Pilot-A" }),
  });
  const joinB = await request(`/api/sessions/${session.code}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Pilot-B" }),
  });
  console.log("Joined 2 participants");

  await request(`/api/sessions/${session.code}/consent`, { method: "POST" });
  console.log("Consent recorded");

  const preAnswers = { "pre-1": 1, "pre-2": 2, "pre-3": 1, "pre-4": 1, "pre-5": 1 };
  await request(`/api/sessions/${session.code}/assessment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assessmentType: "pre",
      answers: preAnswers,
      participantId: joinB.participant.id,
    }),
  });
  console.log("Pre-test recorded");

  await request(`/api/sessions/${session.code}/scenario/1`);
  console.log("Loaded scenario 1");

  await request(`/api/sessions/${session.code}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenarioOrder: 1,
      discussionText: "Pilot group discussion about photosynthesis.",
      draftAnswer: "Plants use sunlight to make food.",
    }),
  });
  console.log("Synced discussion");

  const scaffold = await request(`/api/sessions/${session.code}/scaffold`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenarioOrder: 1,
      scaffoldingType: "guiding_question",
      discussionText: "Pilot group discussion about photosynthesis.",
      draftAnswer: "Plants use sunlight to make food.",
    }),
  });
  console.log("Scaffolding response:", scaffold.aiResponse.slice(0, 80) + "...");

  await request(`/api/sessions/${session.code}/scenario/1`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "submit",
      finalAnswer: "Photosynthesis converts light energy into chemical energy in plants.",
    }),
  });
  console.log("Submitted final answer");

  await request(`/api/sessions/${session.code}/survey`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenarioId: "scenario-01",
      autonomyRating: 4,
      satisfactionRating: 5,
      collaborationRating: 4,
      perceivedHelpfulness: 4,
      openReflection: "Pilot reflection text.",
    }),
  });
  console.log("Survey saved");

  const postAnswers = { "post-1": 1, "post-2": 1, "post-3": 1, "post-4": 1, "post-5": 1 };
  await request(`/api/sessions/${session.code}/assessment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assessmentType: "post",
      answers: postAnswers,
      participantId: joinB.participant.id,
    }),
  });
  console.log("Post-test recorded");

  const exportRes = await fetch(
    `${BASE}/api/admin/export?password=${encodeURIComponent(process.env.ADMIN_PASSWORD ?? "research-admin")}`
  );
  if (!exportRes.ok) throw new Error("Export failed");
  const csv = await exportRes.text();
  console.log("Export rows:", csv.split("\n").length - 1);
  console.log("Pilot test PASSED");
}

main().catch((error) => {
  console.error("Pilot test FAILED:", error.message);
  process.exit(1);
});
