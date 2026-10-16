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
      post({
        assessmentType: "pre",
        answers: PRE_ANSWERS,
        participantId,
      })
    );
  }
  console.log("Consent and pre-tests recorded");

  // Scenario 1: guiding question
  await request(`/api/sessions/${code}/scenario/1`);
  const sendMessage = (scenarioOrder, participantId, text) =>
    request(`/api/sessions/${code}/messages`, post({ scenarioOrder, participantId, text }));

  const first = await sendMessage(1, studentA, "Plants make food from light.");
  const second = await sendMessage(1, studentB, "They also need water and CO2.");
  if (first.message.authorName !== "Pilot-A" || second.message.authorName !== "Pilot-B") {
    throw new Error("Chat messages missing author names");
  }
  if (first.message.colorIndex === second.message.colorIndex) {
    throw new Error("Students should get different chat colours");
  }
  await expectRejected(
    `/api/sessions/${code}/messages`,
    post({ scenarioOrder: 1, participantId: studentA, text: "   " }),
    "empty chat message"
  );
  console.log("Chat messages from both students saved with names and colours");

  const scaffold = (body) => post({ scenarioOrder: 1, ...body });
  const scaffoldPath = `/api/sessions/${code}/scaffold`;
  const proposeBody = {
    action: "propose",
    scaffoldingType: "guiding_question",
    participantId: studentA,
  };
  await expectRejected(scaffoldPath, scaffold(proposeBody), "proposal without a help reason");

  const firstProposal = await request(scaffoldPath, scaffold({ ...proposeBody, helpReason: "stuck" }));
  await expectRejected(
    scaffoldPath,
    scaffold({ action: "agree", proposalId: firstProposal.proposal.id, participantId: studentA }),
    "agreeing to your own proposal"
  );
  await expectRejected(
    scaffoldPath,
    scaffold({ ...proposeBody, participantId: studentB, helpReason: "want_feedback" }),
    "a second proposal while one is pending"
  );
  await request(
    scaffoldPath,
    scaffold({ action: "cancel", proposalId: firstProposal.proposal.id, participantId: studentB })
  );
  console.log("Proposal cancelled by the other student");

  const secondProposal = await request(
    scaffoldPath,
    scaffold({ ...proposeBody, scaffoldingType: "hint", helpReason: "stuck" })
  );
  if (secondProposal.proposal.proposedByName !== "Pilot-A") {
    throw new Error("Proposal missing proposer name");
  }
  const agreeBody = scaffold({
    action: "agree",
    proposalId: secondProposal.proposal.id,
    participantId: studentB,
  });
  const [agreeOne, agreeTwo] = await Promise.all([
    fetch(`${BASE}${scaffoldPath}`, agreeBody),
    fetch(`${BASE}${scaffoldPath}`, agreeBody),
  ]);
  if ([agreeOne.ok, agreeTwo.ok].filter(Boolean).length !== 1) {
    throw new Error("Two simultaneous agreements should produce exactly one AI request");
  }
  const agreed = await (agreeOne.ok ? agreeOne : agreeTwo).json();
  if (agreed.proposedByName !== "Pilot-A" || agreed.agreedByName !== "Pilot-B") {
    throw new Error("Agreement missing proposer or agreer");
  }
  console.log("Simultaneous agreements produced one AI request");
  console.log("Scaffolding response:", agreed.aiResponse.slice(0, 80) + "...");

  await sendMessage(1, studentB, "So the AI is asking where the energy comes from.");
  await request(
    `/api/sessions/${code}/sync`,
    post({
      scenarioOrder: 1,
      participantId: studentA,
      fields: { finalAnswer: "Photosynthesis converts light energy" },
      edits: [{ field: "finalAnswer", charsAdded: 36, charsRemoved: 0, insertedText: "Photosynthesis converts light energy" }],
    })
  );

  await request(
    `/api/sessions/${code}/scenario/1`,
    post(
      {
        action: "submit",
        participantId: studentB,
        finalAnswer: "Photosynthesis converts light energy, water and CO2 into sugar and oxygen.",
      },
      "PUT"
    )
  );
  console.log("Submitted final answer for scenario 1");
  await expectRejected(
    `/api/sessions/${code}/messages`,
    post({ scenarioOrder: 1, participantId: studentA, text: "Too late" }),
    "chat message after the scenario was submitted"
  );

  const statusA = await request(`/api/sessions/${code}/scenario/1?participantId=${studentA}`);
  if (statusA.surveyCompleted) throw new Error("Student A should still need to rate");
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
  const statusAfter = await request(`/api/sessions/${code}/scenario/1?participantId=${studentA}`);
  if (!statusAfter.surveyCompleted) throw new Error("Student A rating not recorded");
  console.log("Both students rated scenario 1 (duplicate ignored)");

  // Scenario 2: full answer requires an own-words explanation
  await request(`/api/sessions/${code}/scenario/2`);
  await sendMessage(2, studentB, "We think steam engines were not the only cause.");
  const fullAnswerProposal = await request(
    `/api/sessions/${code}/scaffold`,
    post({
      action: "propose",
      scenarioOrder: 2,
      scaffoldingType: "full_answer",
      helpReason: "unsure_correct",
      participantId: studentB,
    })
  );
  await request(
    `/api/sessions/${code}/scaffold`,
    post({
      action: "agree",
      scenarioOrder: 2,
      proposalId: fullAnswerProposal.proposal.id,
      participantId: studentA,
    })
  );
  const finalAnswer = {
    action: "submit",
    participantId: studentA,
    finalAnswer: "Many factors including coal, capital, and trade drove it.",
  };
  await expectRejected(
    `/api/sessions/${code}/scenario/2`,
    post({ ...finalAnswer, ownWordsExplanation: "Too short." }, "PUT"),
    "full answer submission without an own-words explanation"
  );
  await request(
    `/api/sessions/${code}/scenario/2`,
    post(
      {
        ...finalAnswer,
        ownWordsExplanation:
          "The AI showed us that the revolution had many causes working together, such as coal, money for investment, trade, and new farming methods.",
      },
      "PUT"
    )
  );
  console.log("Full-answer scenario submitted with own-words explanation");

  for (const participantId of [studentA, studentB]) {
    await request(
      `/api/sessions/${code}/assessment`,
      post({
        assessmentType: "post",
        answers: POST_ANSWERS,
        participantId,
      })
    );
    await request(
      `/api/sessions/${code}/reflection`,
      post({
        participantId,
        answers: { ai_effect_on_collaboration: "It gave us questions to discuss." },
      })
    );
  }
  console.log("Post-tests and end-of-study reflections recorded");

  const rubric = await request(`/api/admin/rubric?rater=pilot`, {
    headers: { "x-admin-password": ADMIN_PASSWORD },
  });
  const attempt = rubric.attempts.find((a) => a.sessionCode === code);
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
  const row = scenarios.find((line) => line.startsWith(code) && line.includes("scenario-01"));
  if (!row) throw new Error("Scenario export missing pilot row");
  for (const column of ["help_reason", "scaffolding_proposed_by", "scaffolding_agreed_by", "proposals_cancelled", "discussion_before_ai", "messages_before_ai", "messages_after_ai", "final_answer", "participation_balance", "final_rubric_mean"]) {
    if (!header.includes(column)) throw new Error(`Scenario export missing column ${column}`);
  }

  const messages = await exportCsv("messages");
  const pilotMessages = messages.filter((line) => line.startsWith(code));
  const scenario1Messages = pilotMessages.filter((line) => line.split(",")[2] === "1");
  const before = scenario1Messages.filter((line) => line.split(",")[3] === "yes").length;
  const after = scenario1Messages.filter((line) => line.split(",")[3] === "no").length;
  if (before !== 2 || after !== 1) {
    throw new Error(`Expected 2 chat messages before AI and 1 after, got ${before} and ${after}`);
  }
  console.log("Chat export splits messages before and after AI correctly");

  const proposals = await exportCsv("proposals");
  const scenario1Proposals = proposals
    .filter((line) => line.startsWith(code))
    .filter((line) => line.split(",")[1] === "1");
  const statuses = scenario1Proposals.map((line) => line.split(",")[7]).sort();
  if (statuses.join(" ") !== "agreed cancelled") {
    throw new Error(`Expected one cancelled and one agreed proposal, got: ${statuses.join(", ")}`);
  }
  console.log("Proposal export records the cancelled and the agreed proposal");

  const ratings = await exportCsv("ratings");
  const pilotRatings = ratings.filter((line) => line.startsWith(code));
  if (pilotRatings.length !== 2) {
    throw new Error(`Expected 2 individual ratings, got ${pilotRatings.length}`);
  }

  const contributions = await exportCsv("contributions");
  const pilotContributions = contributions.filter((line) => line.startsWith(code));
  console.log("Contribution rows for pilot session:", pilotContributions.length);
  const contributionHeader = contributions[0].split(",");
  const messageCountColumn = contributionHeader.indexOf("messages_before_ai");
  const scenario1Contributions = pilotContributions.filter((line) => line.split(",")[2] === "1");
  if (!scenario1Contributions.every((line) => Number(line.split(",")[messageCountColumn]) === 1)) {
    throw new Error("Each student should have 1 chat message before AI in scenario 1");
  }

  const assessments = await exportCsv("assessments");
  const assessmentHeader = assessments[0].split(",");
  const column = (name) => assessmentHeader.indexOf(name);
  const preRow = assessments
    .find((line) => line.startsWith(code) && line.split(",")[2] === "pre")
    ?.split(",");
  const postRow = assessments
    .find((line) => line.startsWith(code) && line.split(",")[2] === "post")
    ?.split(",");
  if (!preRow || preRow[column("score")] !== "6" || preRow[column("max_score")] !== "8") {
    throw new Error("Pre-test should score 6 out of 8");
  }
  if (preRow[column("correct_definition")] !== "0" || preRow[column("correct_overreliance")] !== "0") {
    throw new Error("Per-concept pre-test columns are wrong");
  }
  if (!postRow || postRow[column("score")] !== "8" || postRow[column("correct_definition")] !== "1") {
    throw new Error("Post-test should score 8 out of 8 with per-concept columns");
  }
  console.log("Assessment export has scores and per-concept columns (pre 6/8, post 8/8)");

  for (const type of ["edits", "reflections", "rubric", "assessments"]) {
    const lines = await exportCsv(type);
    console.log(`Export ${type}: ${lines.filter((line) => line.startsWith(code)).length} pilot rows`);
  }

  console.log("Pilot test PASSED");
}

main().catch((error) => {
  console.error("Pilot test FAILED:", error.message);
  process.exit(1);
});
