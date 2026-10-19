#!/usr/bin/env node
/**
 * Pilot validation script — simulates core research flow without a browser.
 * Run after starting the server: npm run dev
 * Then: npm run pilot:test
 */

const BASE = process.env.PILOT_BASE_URL ?? "http://localhost:3000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "research-admin";

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path}: ${data.error ?? res.statusText}`);
  }
  return data;
}

async function expectRejected(path, options, description) {
  const res = await fetch(`${BASE}${path}`, options);
  if (res.ok) throw new Error(`Expected rejection: ${description}`);
  console.log(`Rejected as expected: ${description}`);
}

function post(body, method = "POST") {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const RATINGS = {
  perceivedHelpfulness: 4,
  supportAmount: "appropriate",
  aiHelpedDiscussion: 4,
  aiHelpedFocus: 3,
  aiHelpedInclusion: 3,
  aiHelpedDisagreement: null,
  collaborationRating: 4,
  sharedAnswerRating: 5,
  autonomyRating: 4,
  aiHelpedThinking: 4,
  overRelianceRating: 2,
  couldAnswerWithoutAi: 3,
  satisfactionRating: 5,
};

const NO_AI_RATINGS = {
  collaborationRating: 4,
  sharedAnswerRating: 4,
  autonomyRating: 5,
  satisfactionRating: 4,
};

// Pre-test: 6 of 8 correct (pre-1 and pre-6 wrong). Post-test: all 8 correct.
const PRE_ANSWERS = {
  "pre-1": 0, "pre-2": 3, "pre-3": 0, "pre-4": 2,
  "pre-5": 0, "pre-6": 0, "pre-7": 2, "pre-8": 1,
};
const POST_ANSWERS = {
  "post-1": 2, "post-2": 0, "post-3": 3, "post-4": 1,
  "post-5": 3, "post-6": 1, "post-7": 0, "post-8": 2,
};

async function exportCsv(type) {
  const res = await fetch(`${BASE}/api/admin/export?type=${type}`, {
    headers: { "x-admin-password": ADMIN_PASSWORD },
  });
  if (!res.ok) throw new Error(`Export ${type} failed`);
  return (await res.text()).split("\n");
}

async function main() {
  console.log("Pilot test starting against", BASE);

  const session = await request("/api/sessions", { method: "POST" });
  const code = session.code;
  console.log("Created session:", code);

  const joinA = await request(`/api/sessions/${code}/join`, post({ displayName: "Pilot-A" }));
  const joinB = await request(`/api/sessions/${code}/join`, post({ displayName: "Pilot-B" }));
  const studentA = joinA.participant.id;
  const studentB = joinB.participant.id;
  console.log("Joined 2 participants");

  await request(`/api/sessions/${code}/consent`, { method: "POST" });
  for (const participantId of [studentA, studentB]) {
    await request(
      `/api/sessions/${code}/assessment`,
      post({ assessmentType: "pre", answers: PRE_ANSWERS, participantId })
    );
  }
  console.log("Consent and pre-tests recorded");

  const sendMessage = (scenarioOrder, participantId, text) =>
    request(`/api/sessions/${code}/messages`, post({ scenarioOrder, participantId, text }));
  const scaffoldPath = `/api/sessions/${code}/scaffold`;
  const support = (scenarioOrder, participantId, scaffoldingType, action = "select") =>
    request(scaffoldPath, post({ action, scenarioOrder, participantId, scaffoldingType }));
  const writeAnswer = (scenarioOrder, participantId, finalAnswer, authorship) =>
    request(
      `/api/sessions/${code}/sync`,
      post({
        scenarioOrder,
        participantId,
        fields: { finalAnswer },
        authorship,
        edits: [{ field: "finalAnswer", charsAdded: finalAnswer.length, charsRemoved: 0, insertedText: finalAnswer }],
      })
    );
  const setReady = (scenarioOrder, participantId, ready) =>
    request(
      `/api/sessions/${code}/scenario/${scenarioOrder}`,
      post({ action: "ready", participantId, ready }, "PUT")
    );
  const scenarioFor = (scenarioOrder, participantId) =>
    request(`/api/sessions/${code}/scenario/${scenarioOrder}?participantId=${participantId}`);

  // Scenario 1: chat, individual AI support, coloured group answer, "I am good"
  const initial = await scenarioFor(1, studentA);
  assert(initial.members.length === 2, "Scenario should list both members");
  assert(initial.members[0].colorIndex !== initial.members[1].colorIndex, "Members need different colours");

  const first = await sendMessage(1, studentA, "Collaboration needs everyone to contribute.");
  const second = await sendMessage(1, studentB, "And each of us should be accountable.");
  assert(
    first.message.authorName === "Pilot-A" && second.message.authorName === "Pilot-B",
    "Chat messages missing author names"
  );
  assert(first.message.colorIndex !== second.message.colorIndex, "Students should get different chat colours");
  await expectRejected(
    `/api/sessions/${code}/messages`,
    post({ scenarioOrder: 1, participantId: studentA, text: "   " }),
    "empty chat message"
  );
  console.log("Chat messages from both students saved with names and colours");

  await expectRejected(
    scaffoldPath,
    post({ action: "select", scenarioOrder: 1, participantId: studentA, scaffoldingType: "no_assistance" }),
    "selecting 'no assistance' as an AI option"
  );
  const hint = await support(1, studentA, "hint");
  assert(hint.cached === false && hint.scaffold.selected, "First selection should call the AI");
  const hidden = await support(1, studentA, "hint", "unselect");
  assert(hidden.scaffold.selected === false, "Unselect should hide the response");
  const shownAgain = await support(1, studentA, "hint");
  assert(shownAgain.cached === true, "Selecting again must reuse the stored response");
  assert(shownAgain.scaffold.aiResponse === hint.scaffold.aiResponse, "Stored response changed");
  const explanation = await support(1, studentA, "explanation");
  assert(explanation.cached === false, "A second type gets its own response");
  console.log("Student A selected two AI options; unselect/select reused the stored response");

  const [guideOne, guideTwo] = await Promise.all([
    support(1, studentB, "guiding_question"),
    support(1, studentB, "guiding_question"),
  ]);
  assert(
    guideOne.scaffold.aiResponse === guideTwo.scaffold.aiResponse,
    "Two simultaneous selections should end with one stored response"
  );

  const viewA = await scenarioFor(1, studentA);
  const viewB = await scenarioFor(1, studentB);
  const typesA = viewA.myScaffolds.map((s) => s.scaffoldingType).sort().join(",");
  const typesB = viewB.myScaffolds.map((s) => s.scaffoldingType).join(",");
  assert(typesA === "explanation,hint", `Student A should see only their own support, got ${typesA}`);
  assert(typesB === "guiding_question", `Student B should see only their own support, got ${typesB}`);
  console.log("AI support is private: each student sees only their own responses");

  await sendMessage(1, studentB, "My AI asked how we keep everyone involved.");

  const textA = "Collaborative learning means working together towards one shared goal.";
  await writeAnswer(1, studentA, textA, [{ participantId: studentA, length: textA.length }]);
  const textAB = `${textA} Each member is accountable for their part.`;
  await writeAnswer(1, studentB, textAB, [
    { participantId: studentA, length: textA.length },
    { participantId: studentB, length: textAB.length - textA.length },
  ]);
  const saved = await scenarioFor(1, studentA);
  assert(saved.attempt.finalAnswer === textAB, "Group answer not saved");
  assert(
    saved.attempt.finalAnswerAuthorship.length === 2 &&
      saved.attempt.finalAnswerAuthorship[1].participantId === studentB,
    "Answer authorship (who typed what) not saved"
  );
  await expectRejected(
    `/api/sessions/${code}/sync`,
    post({ scenarioOrder: 1, participantId: studentA, fields: { finalAnswer: "word ".repeat(501) } }),
    "a group answer over 500 words"
  );
  console.log("Group answer saved with per-student authorship; 500-word limit enforced");

  const readyA = await setReady(1, studentA, true);
  assert(readyA.submitted === false && readyA.readyIds.length === 1, "One ready member must not submit");
  await expectRejected(
    `/api/sessions/${code}/sync`,
    post({ scenarioOrder: 1, participantId: studentA, fields: { finalAnswer: `${textAB} More.` } }),
    "editing while marked 'I am good'"
  );
  const unreadyA = await setReady(1, studentA, false);
  assert(unreadyA.readyIds.length === 0, "Unselecting 'I am good' should remove the member");
  await setReady(1, studentA, true);
  const readyB = await setReady(1, studentB, true);
  assert(readyB.submitted === true, "Everyone ready should finish the scenario");
  const finished = await scenarioFor(1, studentB);
  assert(finished.attempt.submitted, "Scenario 1 should be submitted");
  console.log("Scenario 1 finished only after both students selected 'I am good'");

  await expectRejected(
    `/api/sessions/${code}/messages`,
    post({ scenarioOrder: 1, participantId: studentA, text: "Too late" }),
    "chat message after the scenario finished"
  );
  await expectRejected(
    scaffoldPath,
    post({ action: "select", scenarioOrder: 1, participantId: studentB, scaffoldingType: "example" }),
    "new AI request after the scenario finished"
  );

  for (const participantId of [studentA, studentB]) {
    await request(
      `/api/sessions/${code}/survey`,
      post({ scenarioId: "scenario-01", participantId, ...RATINGS })
    );
  }
  await request(
    `/api/sessions/${code}/survey`,
    post({ scenarioId: "scenario-01", participantId: studentA, ...RATINGS })
  );
  const statusAfter = await scenarioFor(1, studentA);
  assert(statusAfter.surveyCompleted, "Student A rating not recorded");
  console.log("Both students rated scenario 1 (duplicate ignored)");

  // Scenario 2: only student A uses AI (full answer); student B uses none
  await sendMessage(2, studentB, "Let's agree on how we handle disagreement.");
  await support(2, studentA, "full_answer");
  await expectRejected(
    `/api/sessions/${code}/scenario/2`,
    post({ action: "ready", participantId: studentA, ready: true }, "PUT"),
    "'I am good' before anything is written"
  );
  const answer2 = "We compare reasons using shared criteria before deciding.";
  await writeAnswer(2, studentB, answer2, [{ participantId: studentB, length: answer2.length }]);
  await expectRejected(
    `/api/sessions/${code}/survey`,
    post({ scenarioId: "scenario-02", participantId: studentB, ...NO_AI_RATINGS }),
    "rating before the group answer is finished"
  );
  await setReady(2, studentB, true);
  const done2 = await setReady(2, studentA, true);
  assert(done2.submitted, "Scenario 2 should finish when both are ready");
  await request(
    `/api/sessions/${code}/survey`,
    post({ scenarioId: "scenario-02", participantId: studentB, ...NO_AI_RATINGS })
  );
  await request(
    `/api/sessions/${code}/survey`,
    post({ scenarioId: "scenario-02", participantId: studentA, ...RATINGS })
  );
  console.log("Scenario 2: student without AI rated without the AI questions");

  for (const participantId of [studentA, studentB]) {
    await request(
      `/api/sessions/${code}/assessment`,
      post({ assessmentType: "post", answers: POST_ANSWERS, participantId })
    );
    await request(
      `/api/sessions/${code}/reflection`,
      post({
        participantId,
        answers: { ai_effect_on_collaboration: "It gave me questions to bring to the group." },
      })
    );
  }
  console.log("Post-tests and end-of-study reflections recorded");

  const rubric = await request(`/api/admin/rubric?rater=pilot`, {
    headers: { "x-admin-password": ADMIN_PASSWORD },
  });
  const attempt = rubric.attempts.find((a) => a.sessionCode === code && a.scenarioOrder === 1);
  assert(
    attempt.aiTypesUsed.sort().join(",") === "explanation,guiding_question,hint",
    "Rubric view should list the AI types the members used"
  );
  await request(`/api/admin/rubric`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-password": ADMIN_PASSWORD },
    body: JSON.stringify({
      attemptId: attempt.id,
      rater: "pilot",
      correctness: 4,
      clarity: 3,
      reasoning: 3,
      completeness: 3,
      useOfExamples: 2,
      depth: 2,
    }),
  });
  console.log("Rubric score saved for final answer");

  const scenarios = await exportCsv("scenarios");
  const header = scenarios[0].split(",");
  for (const column of ["members_using_ai", "ai_types_used", "highest_support_level_used", "discussion_before_ai", "messages_before_ai", "final_answer", "final_overlap_with_ai", "final_authorship_balance", "participation_balance", "final_rubric_mean"]) {
    assert(header.includes(column), `Scenario export missing column ${column}`);
  }

  const aiSupport = await exportCsv("ai_support");
  const aiHeader = aiSupport[0].split(",");
  const aiRows = aiSupport.filter((line) => line.startsWith(code)).map((line) => line.split(","));
  assert(aiRows.length === 4, `Expected 4 individual AI requests, got ${aiRows.length}`);
  const hintRow = aiRows.find((r) => r[aiHeader.indexOf("scaffolding_type")] === "hint");
  assert(
    hintRow[aiHeader.indexOf("times_selected")] === "2" &&
      hintRow[aiHeader.indexOf("times_unselected")] === "1" &&
      hintRow[aiHeader.indexOf("selected_at_end")] === "yes",
    "AI support export should count selections and unselections"
  );
  console.log("AI support export has one row per student and option, with toggle counts");

  const messages = await exportCsv("messages");
  const scenario1Messages = messages
    .filter((line) => line.startsWith(code))
    .filter((line) => line.split(",")[2] === "1");
  const before = scenario1Messages.filter((line) => line.split(",")[3] === "yes").length;
  const after = scenario1Messages.filter((line) => line.split(",")[3] === "no").length;
  assert(before === 2 && after === 1, `Expected 2 chat messages before AI and 1 after, got ${before} and ${after}`);
  console.log("Chat export splits messages before and after the first AI request");

  const ratings = await exportCsv("ratings");
  const ratingsHeader = ratings[0].split(",");
  const pilotRatings = ratings.filter((line) => line.startsWith(code)).map((l) => l.split(","));
  assert(pilotRatings.length === 4, `Expected 4 individual ratings, got ${pilotRatings.length}`);
  const noAiRating = pilotRatings.find(
    (r) => r[ratingsHeader.indexOf("scenario_order")] === "2" && r[ratingsHeader.indexOf("ai_used")] === "no"
  );
  assert(noAiRating, "Ratings export should mark the student who used no AI");

  const contributions = await exportCsv("contributions");
  const cHeader = contributions[0].split(",");
  const scenario1Contributions = contributions
    .filter((line) => line.startsWith(code))
    .map((line) => line.split(","))
    .filter((r) => r[cHeader.indexOf("scenario_order")] === "1");
  const shares = scenario1Contributions.map((r) => Number(r[cHeader.indexOf("final_answer_share")]));
  assert(
    shares.length === 2 && Math.abs(shares[0] + shares[1] - 1) < 0.01 && shares.every((s) => s > 0),
    `Both students should share authorship of the scenario 1 answer, got ${shares.join(", ")}`
  );
  console.log("Contributions export shows each student's share of the final answer");

  const assessments = await exportCsv("assessments");
  const assessmentHeader = assessments[0].split(",");
  const column = (name) => assessmentHeader.indexOf(name);
  const preRow = assessments
    .find((line) => line.startsWith(code) && line.split(",")[2] === "pre")
    ?.split(",");
  const postRow = assessments
    .find((line) => line.startsWith(code) && line.split(",")[2] === "post")
    ?.split(",");
  assert(preRow && preRow[column("score")] === "6" && preRow[column("max_score")] === "8", "Pre-test should score 6 out of 8");
  assert(
    preRow[column("correct_definition")] === "0" && preRow[column("correct_overreliance")] === "0",
    "Per-concept pre-test columns are wrong"
  );
  assert(postRow && postRow[column("score")] === "8" && postRow[column("correct_definition")] === "1", "Post-test should score 8 out of 8");
  console.log("Assessment export has scores and per-concept columns (pre 6/8, post 8/8)");

  for (const type of ["edits", "reflections", "rubric"]) {
    const lines = await exportCsv(type);
    console.log(`Export ${type}: ${lines.filter((line) => line.startsWith(code)).length} pilot rows`);
  }

  console.log("Pilot test PASSED");
}

main().catch((error) => {
  console.error("Pilot test FAILED:", error.message);
  process.exit(1);
});
