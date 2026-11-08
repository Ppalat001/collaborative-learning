#!/usr/bin/env node
/**
 * End-to-end check of Adaptive Scaffolding V2 over real HTTP and Socket.IO.
 * Checks that a home-page group is a V2 group by default, then runs one
 * proactive_group on the test-only accelerated policy (mock AI).
 *
 * Run it through `npm run pilot:isolated` (throwaway database). Against a running
 * server it needs ADAPTIVE_V2_ALLOW_TEST_POLICY=true, and it writes two test
 * groups into that server's database.
 */
import { io } from "socket.io-client";

const BASE = process.env.PILOT_BASE_URL ?? "http://localhost:3000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "research-admin";
const WAIT_MS = 30_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const ok = (message) => console.log(`  ok  ${message}`);

async function call(path, { method = "GET", token, body, admin } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["x-participant-token"] = token;
  if (admin) headers["x-admin-password"] = ADMIN_PASSWORD;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    // CSV and other text bodies
  }
  return { status: res.status, data };
}

async function expectOk(path, init) {
  const result = await call(path, init);
  if (result.status >= 400) {
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${result.status} ${JSON.stringify(result.data)}`);
  }
  return result.data;
}

async function expectStatus(path, init, status, description) {
  const result = await call(path, init);
  assert(result.status === status, `${description}: expected ${status}, got ${result.status} ${JSON.stringify(result.data)}`);
  ok(description);
  return result.data;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field);
  rows.push(row);
  const [header, ...lines] = rows;
  return lines
    .filter((line) => line.length === header.length)
    .map((line) => Object.fromEntries(header.map((name, i) => [name, line[i]])));
}

async function exportRows(type, code) {
  const res = await call(`/api/admin/export?type=${type}&session=${code}`, { admin: true });
  assert(res.status === 200, `export ${type} failed with ${res.status}`);
  return parseCsv(String(res.data).replace(/^\uFEFF/, "").replace(/\r/g, ""));
}

/** Connects a member's socket to the scenario room and records every event it receives. */
function connect(code, member, scenarioOrder, token = member.token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { path: "/socket.io", transports: ["websocket"], forceNew: true, reconnection: false });
    const events = [];
    const timer = setTimeout(() => reject(new Error(`${member.name}: socket join timed out`)), 10_000);
    socket.onAny((event, payload) => events.push({ event, payload }));
    socket.on("connect", () =>
      socket.emit("room:join", {
        sessionCode: code,
        scenarioOrder,
        participantName: member.name,
        participantId: member.id,
        participantToken: token,
      })
    );
    socket.once("participant:joined", () => {
      clearTimeout(timer);
      resolve({ socket, events, denied: null });
    });
    socket.once("room:denied", (payload) => {
      clearTimeout(timer);
      resolve({ socket, events, denied: payload.reason });
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function waitFor(events, predicate, description, timeout = WAIT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out after ${timeout / 1000} s waiting for: ${description}`);
}

const PRE_ANSWERS = {
  "pre-1": 0, "pre-2": 3, "pre-3": 0, "pre-4": 2,
  "pre-5": 1, "pre-6": 0, "pre-7": 3, "pre-8": 1,
};
const OPEN_PRE = {
  open_collaboration: "Working on the same task together.",
  open_ai_role: "Use it for hints only.",
};

async function main() {
  console.log("Adaptive Scaffolding V2 pilot against", BASE);

  const home = await expectOk("/api/sessions", { method: "POST" });
  const homeInfo = await expectOk(`/api/sessions/${home.code}`);
  assert(homeInfo.v2?.condition === "proactive_group", `Home-page group should be V2 proactive_group: ${JSON.stringify(homeInfo.v2)}`);
  assert(homeInfo.v2.minGroupSize === 2 && homeInfo.v2.maxGroupSize === 4, "Home-page group size should be 2-4");
  ok(`a group created from the home page (${home.code}) is a V2 proactive_group without any settings`);

  const created = await call("/api/admin/sessions", {
    method: "POST",
    admin: true,
    body: {
      condition: "proactive_group",
      policyVersion: "policy-v2-test-accelerated",
      features: { openingPrompt: true, checkpoints: true, roles: false, initialIdea: "off", agreementReason: "off" },
    },
  });
  if (created.status === 403) {
    throw new Error(
      `V2 group creation refused (${created.data.error}). Start the server with ADAPTIVE_V2_ALLOW_TEST_POLICY=true.`
    );
  }
  assert(created.status === 200, `Admin group creation failed: ${created.status} ${JSON.stringify(created.data)}`);
  const code = created.data.code;
  assert(created.data.condition === "proactive_group", "Wrong assignment");
  ok(`researcher created group ${code} (proactive_group, ${created.data.interventionPolicyVersion})`);

  const join = async (name) => {
    const data = await expectOk(`/api/sessions/${code}/join`, { method: "POST", body: { displayName: name } });
    assert(data.participantToken, "V2 join must issue a device token");
    return { name, id: data.participant.id, token: data.participantToken };
  };
  const A = await join("Pilot-A");
  const B = await join("Pilot-B");
  ok("two members joined; each received a device token");

  const consentDoc = await expectOk(`/api/sessions/${code}/consent`);
  const statements = consentDoc.document.checkboxes.map((c) => c.id);
  assert(statements.length > 0, "Consent form has no statements");
  await expectStatus(
    `/api/sessions/${code}/assessment`,
    { method: "POST", token: A.token, body: { assessmentType: "pre", answers: PRE_ANSWERS, openAnswers: OPEN_PRE, participantId: A.id } },
    403,
    "pre-test refused before the member's own consent"
  );
  await expectStatus(
    `/api/sessions/${code}/consent`,
    { method: "POST", token: A.token, body: { participantId: A.id, confirmedStatements: statements.slice(1) } },
    400,
    "consent refused when a statement is not confirmed"
  );
  await expectStatus(
    `/api/sessions/${code}/consent`,
    { method: "POST", token: B.token, body: { participantId: A.id, confirmedStatements: statements } },
    401,
    "one member cannot consent for another"
  );
  for (const m of [A, B]) {
    await expectOk(`/api/sessions/${code}/consent`, {
      method: "POST",
      token: m.token,
      body: { participantId: m.id, confirmedStatements: statements },
    });
    await expectOk(`/api/sessions/${code}/assessment`, {
      method: "POST",
      token: m.token,
      body: { assessmentType: "pre", answers: PRE_ANSWERS, openAnswers: OPEN_PRE, participantId: m.id },
    });
  }
  ok("each member consented on their own and finished the pre-test");

  await expectStatus(
    `/api/sessions/${code}/scenario/1?participantId=${A.id}`,
    { token: A.token },
    409,
    "scenarios stay locked until the group starts"
  );
  const started = await expectOk(`/api/sessions/${code}/start`, { method: "POST", token: A.token, body: { participantId: A.id } });
  assert(started.started && started.rosterSize === 2, "Start gate failed");
  ok("start gate passed; roster frozen at 2 members");
  const late = await call(`/api/sessions/${code}/join`, { method: "POST", body: { displayName: "Pilot-Late" } });
  assert(late.status >= 400, "Late join must be refused");
  ok("late join refused after the start");
  await expectStatus(`/api/sessions/${code}/scenario/1?participantId=${A.id}`, {}, 401, "scenario refused without the device token");
  const scenario = await expectOk(`/api/sessions/${code}/scenario/1?participantId=${A.id}`, { token: A.token });
  assert(scenario.v2, "Scenario response should carry the V2 state");
  ok("scenario loads with the device token");

  const intruder = await connect(code, A, 1, B.token);
  assert(intruder.denied === "auth_failed", `Socket with the wrong token should be denied, got ${intruder.denied}`);
  intruder.socket.close();
  ok("socket join with another member's token denied");
  let sa = await connect(code, A, 1);
  const sb = await connect(code, B, 1);
  assert(!sa.denied && !sb.denied, "Members' sockets should join");
  ok("both members connected to the scenario room");

  // 1. Proactive group offer after initial silence (accelerated policy: 4 s).
  const offered = await waitFor(
    sa.events,
    (e) => e.event === "intervention:offered" && e.payload.scope === "group",
    "a proactive group offer"
  );
  const groupOffer = offered.payload;
  assert(groupOffer.status === "suggested" && groupOffer.content === null, "A proactive offer must not contain content yet");
  assert(groupOffer.initiatedBy === "system" && groupOffer.reasonExplanation, "Offer must explain why it appeared");
  await waitFor(sb.events, (e) => e.event === "intervention:offered" && e.payload.id === groupOffer.id, "B sees the group offer");
  ok(`proactive group offer (${groupOffer.trigger} -> ${groupOffer.supportType}) reached both members with its reason and no content`);

  const accepted = await expectOk(`/api/sessions/${code}/interventions/${groupOffer.id}/feedback`, {
    method: "POST",
    token: B.token,
    body: { participantId: B.id, action: "accepted" },
  });
  assert(accepted.intervention.status === "delivered", `Accepted offer should be delivered, got ${accepted.intervention.status}`);
  const deliveredA = await waitFor(
    sa.events,
    (e) => e.event === "intervention:delivered" && e.payload.id === groupOffer.id,
    "group delivery reaches A"
  );
  assert(deliveredA.payload.content && deliveredA.payload.aiOrigin === "mock", "Delivered group support should have mock content");
  ok("B accepted; the support was generated once and delivered to the whole group (mock AI)");

  sa.socket.close();
  sa = await connect(code, A, 1);
  assert(!sa.denied, "A should be able to reconnect after the start");
  const reloaded = await expectOk(`/api/sessions/${code}/interventions?scenarioOrder=1&participantId=${A.id}`, { token: A.token });
  assert(
    reloaded.interventions.some((i) => i.id === groupOffer.id && i.status === "delivered" && i.content),
    "Delivered group support should be reloaded from the database after a reconnect"
  );
  ok("A disconnected and reconnected; the delivered group support was reloaded from the database");

  // 2. The retired private coach is unavailable in new groups.
  await expectStatus(
    `/api/sessions/${code}/collaboration`,
    {
      method: "POST",
      token: A.token,
      body: { scenarioOrder: 1, participantId: A.id, action: "preferences", privateOffersOptIn: true },
    },
    403,
    "private coach opt-in is unavailable"
  );
  await expectStatus(
    `/api/sessions/${code}/interventions`,
    {
      method: "POST",
      token: B.token,
      body: { kind: "personal_request", scenarioOrder: 1, participantId: B.id, requestId: "pilot-stuck-1" },
    },
    403,
    "private coach personal requests are unavailable"
  );
  ok("private coach opt-in and personal requests are unavailable in new groups");

  // 3. Manual shared request, Step 2 private AI options and a checkpoint.
  await expectOk(`/api/sessions/${code}/messages`, {
    method: "POST",
    token: A.token,
    body: {
      scenarioOrder: 1,
      participantId: A.id,
      text: "We should compare our reasons before writing the shared answer.",
    },
  });

  const manual = await expectOk(`/api/sessions/${code}/interventions`, {
    method: "POST",
    token: A.token,
    body: { kind: "group_request", supportType: "reasoning_prompt", scenarioOrder: 1, participantId: A.id, requestId: "pilot-manual-1" },
  });
  assert(manual.intervention.scope === "group" && manual.intervention.initiatedBy === "participant", "Manual request should be a group item");
  await waitFor(sb.events, (e) => e.payload?.id === manual.intervention.id, "B sees A's manual group request");
  ok("manual shared facilitator request is visible to the whole group");

  const hint = await expectOk(`/api/sessions/${code}/scaffold`, {
    method: "POST",
    token: A.token,
    body: { action: "select", scenarioOrder: 1, participantId: A.id, scaffoldingType: "hint" },
  });
  assert(hint.scaffold.aiResponse, "Original private AI option should still respond");
  ok("original private AI options still work in V2 groups (token required)");

  await expectOk(`/api/sessions/${code}/collaboration`, {
    method: "POST",
    token: B.token,
    body: { scenarioOrder: 1, participantId: B.id, action: "checkpoint", kind: "evidence" },
  });
  await waitFor(sa.events, (e) => e.event === "checkpoint:raised", "A sees B's checkpoint");
  ok("reflection checkpoint broadcast to the group");

  // 4. Submit the scenario.
  const answer = "Accountability means each member can explain and defend the shared answer.";
  await expectOk(`/api/sessions/${code}/sync`, {
    method: "POST",
    token: A.token,
    body: {
      scenarioOrder: 1,
      participantId: A.id,
      fields: { finalAnswer: answer },
      authorship: [{ participantId: A.id, length: answer.length }],
      edits: [{ field: "finalAnswer", charsAdded: answer.length, charsRemoved: 0, insertedText: answer }],
    },
  });
  for (const m of [A, B]) {
    await expectOk(`/api/sessions/${code}/scenario/1`, {
      method: "PUT",
      token: m.token,
      body: { action: "ready", participantId: m.id, ready: true },
    });
  }
  ok("the group submitted the scenario");

  sa.socket.close();
  sb.socket.close();

  // 5. Research exports and the researcher dashboard.
  const interventions = await exportRows("v2_interventions", code);
  assert(interventions.every((r) => r.group === code && r.research_condition === "proactive_group"), "Provenance missing");
  assert(interventions.length > 0 && interventions.every((r) => r.scope === "group"), "Only group interventions expected");
  const evaluations = await exportRows("v2_evaluations", code);
  assert(evaluations.some((r) => r.decision_action === "no_action"), "Decisions not to intervene should be exported");
  assert(evaluations.some((r) => r.decision_action === "offer"), "Offer decisions should be exported");
  const feedback = await exportRows("v2_feedback", code);
  assert(feedback.some((r) => r.action === "accepted"), "Member responses should be exported");
  const [assignment] = await exportRows("v2_assignment", code);
  assert(/mock_ai_output/.test(assignment.data_quality_flags), "Demo AI text must be flagged");
  ok(`V2 exports: ${interventions.length} interventions, ${evaluations.length} evaluation rows, ${feedback.length} responses, demo AI flagged`);

  const all = await call("/api/admin/export?type=v2_assignment&scope=all", { admin: true });
  assert(all.status === 200, `all-groups export failed with ${all.status}`);
  assert(String(all.data).includes(code) && String(all.data).includes(home.code), "The all-groups export should list both V2 groups");
  ok("the all-V2-groups export contains both groups");

  const messages = await exportRows("messages", code);
  assert(messages.length >= 1, "Original chat export should include the V2 group's messages");
  const dashboard = await expectOk(`/api/admin/interventions?session=${code}`, { admin: true });
  assert(dashboard.warnings.some((w) => w.includes("demo text")), "Dashboard should warn about demo AI text");
  ok("original exports still work for the V2 group; dashboard warns about demo AI text");

  console.log("Adaptive Scaffolding V2 pilot PASSED");
}

main().catch((error) => {
  console.error("Adaptive Scaffolding V2 pilot FAILED:", error.message);
  process.exit(1);
});
