/**
 * Builds scripts/seed-demo-groups.sql: two finished groups of three.
 * Run: node scripts/generate-demo-seed.mjs
 *
 * GROUP-PNGT  Panagiotis, Christos, Papouris
 *   Weak pre-test, heavy use of the full AI answer, short one-author answers,
 *   a little better on the last two scenarios and on the post-test.
 *
 * GROUP-MARA  Maria, Rafaella, Konstantina
 *   Some prior knowledge, full AI answers early, then steadily less help,
 *   shared answers, stronger post-test.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed-demo-groups.sql");

const PRE_CORRECT = [1, 3, 0, 2, 0, 3, 2, 1];
const POST_CORRECT = [2, 0, 3, 1, 3, 1, 0, 2];
const PRE_IDS = ["pre-1", "pre-2", "pre-3", "pre-4", "pre-5", "pre-6", "pre-7", "pre-8"];
const POST_IDS = ["post-1", "post-2", "post-3", "post-4", "post-5", "post-6", "post-7", "post-8"];

function uuid(key) {
  const hex = createHash("sha256").update(`demo-seed:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function anon(key) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const hex = createHash("sha256").update(`anon:${key}`).digest();
  let code = "P-";
  for (let i = 0; i < 8; i++) code += alphabet[hex[i] % alphabet.length];
  return code;
}

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function score(chosen, correct) {
  return chosen.reduce((sum, value, index) => sum + (value === correct[index] ? 1 : 0), 0);
}

function answersJson(ids, chosen) {
  return Object.fromEntries(ids.map((id, index) => [id, chosen[index]]));
}

const sql = [];
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const j = (value) => q(JSON.stringify(value));
const n = (value) => (value === null || value === undefined ? "NULL" : String(value));

function insert(table, row) {
  const columns = Object.keys(row);
  const values = columns.map((column) => row[column]);
  sql.push(
    `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${values.join(", ")});`
  );
}

function buildAnswer(segments) {
  const parts = segments.map((segment, index) => {
    const text = segment.text.trim();
    return {
      who: segment.who,
      text: index < segments.length - 1 ? `${text} ` : text,
    };
  });
  const text = parts.map((part) => part.text).join("");
  return { text, parts };
}

/** One study sitting, 29 Oct 2026, starting 09:00 in UTC+2. */
function buildGroup(spec) {
  const sessionId = uuid(`session:${spec.code}`);
  const people = spec.names.map((name, index) => ({
    name,
    index,
    id: uuid(`participant:${spec.code}:${name}`),
    anonymousId: anon(`${spec.code}:${name}`),
  }));
  const start = Date.parse(spec.start);

  insert("sessions", {
    id: q(sessionId),
    code: q(spec.code),
    current_scenario_index: 10,
    max_participants: 4,
    consent_given: 1,
    created_at: q(iso(start)),
    completed_at: q("COMPLETED_AT"),
  });

  people.forEach((person, index) => {
    const joined = start + (index === 0 ? 8_000 : 40_000 + index * 55_000);
    insert("participants", {
      id: q(person.id),
      session_id: q(sessionId),
      display_name: q(person.name),
      anonymous_id: q(person.anonymousId),
      joined_at: q(iso(joined)),
    });
    insert("research_events", {
      id: q(uuid(`event:${spec.code}:join:${person.name}`)),
      session_id: q(sessionId),
      participant_id: q(person.id),
      event_type: q(index === 0 ? "session_created" : "participant_joined"),
      payload: j(
        index === 0
          ? { code: spec.code }
          : { anonymousId: person.anonymousId, displayName: person.name }
      ),
      created_at: q(iso(index === 0 ? start : joined)),
    });
    if (index === 0) {
      insert("research_events", {
        id: q(uuid(`event:${spec.code}:join-member:${person.name}`)),
        session_id: q(sessionId),
        participant_id: q(person.id),
        event_type: q("participant_joined"),
        payload: j({ anonymousId: person.anonymousId, displayName: person.name }),
        created_at: q(iso(joined)),
      });
    }
  });

  const consentAt = start + 3 * 60_000;
  insert("research_events", {
    id: q(uuid(`event:${spec.code}:consent`)),
    session_id: q(sessionId),
    participant_id: q(people[0].id),
    event_type: q("consent_given"),
    payload: j(null),
    created_at: q(iso(consentAt)),
  });

  people.forEach((person) => {
    const profile = spec.profiles[person.index];
    const preScore = score(profile.pre, PRE_CORRECT);
    const postScore = score(profile.post, POST_CORRECT);
    if (preScore !== profile.preScore) {
      throw new Error(`${person.name} pre-test is ${preScore}, expected ${profile.preScore}`);
    }
    if (postScore !== profile.postScore) {
      throw new Error(`${person.name} post-test is ${postScore}, expected ${profile.postScore}`);
    }
    const preAt = start + profile.preFinishedMin * 60_000;
    insert("assessments", {
      id: q(uuid(`assessment:${spec.code}:${person.name}:pre`)),
      session_id: q(sessionId),
      participant_id: q(person.id),
      assessment_type: q("pre"),
      answers: j(answersJson(PRE_IDS, profile.pre)),
      open_answers: j({
        open_collaboration: profile.preOpen[0],
        open_ai_role: profile.preOpen[1],
      }),
      score: preScore,
      max_score: 8,
      completed_at: q(iso(preAt)),
    });
    insert("research_events", {
      id: q(uuid(`event:${spec.code}:pre:${person.name}`)),
      session_id: q(sessionId),
      participant_id: q(person.id),
      event_type: q("assessment_completed"),
      payload: j({ assessmentType: "pre", score: preScore, maxScore: 8 }),
      created_at: q(iso(preAt)),
    });
    person.preAt = preAt;
  });

  let cursor = Math.max(...people.map((person) => person.preAt)) + 90_000;

  for (const scenario of spec.scenarios) {
    const scenarioStart = cursor;
    const attemptId = uuid(`attempt:${spec.code}:${scenario.order}`);
    const answer = buildAnswer(scenario.segments);
    const wordCount = words(answer.text);
    if (wordCount < spec.answerWords[0] || wordCount > spec.answerWords[1]) {
      throw new Error(
        `${spec.code} scenario ${scenario.order} has ${wordCount} words (limit ${spec.answerWords.join("-")})`
      );
    }
    const authors = new Set(answer.parts.map((part) => part.who));
    if (authors.size < 1) throw new Error(`${spec.code} scenario ${scenario.order} has no author`);
    if (scenario.allThree && authors.size !== 3) {
      throw new Error(`${spec.code} scenario ${scenario.order} should include all three`);
    }
    if (!scenario.allThree && spec.rarelyAllThree && authors.size === 3) {
      throw new Error(`${spec.code} scenario ${scenario.order} unexpectedly includes all three`);
    }

    const aiEvents = scenario.ai.map((request, index) => {
      const at = scenarioStart + request.at * 1000;
      return { ...request, at, id: uuid(`ai:${spec.code}:${scenario.order}:${index}`) };
    });
    const firstAi = aiEvents.length > 0 ? Math.min(...aiEvents.map((event) => event.at)) : null;

    const messages = scenario.chat.map((message, index) => ({
      who: message[0],
      at: scenarioStart + message[1] * 1000,
      text: message[2],
      id: uuid(`msg:${spec.code}:${scenario.order}:${index}`),
    }));
    if (firstAi !== null && !messages.some((message) => message.at < firstAi)) {
      throw new Error(`${spec.code} scenario ${scenario.order} has no chat before AI`);
    }

    const readyAt = scenario.ready.map((who, index) => ({
      who,
      at: scenarioStart + (scenario.readyAt + index * 25) * 1000,
    }));
    const submittedAt = readyAt[readyAt.length - 1].at;
    const submittedBy = people[readyAt[readyAt.length - 1].who].id;

    insert("scenario_attempts", {
      id: q(attemptId),
      session_id: q(sessionId),
      scenario_id: q(`scenario-${String(scenario.order).padStart(2, "0")}`),
      scenario_order: scenario.order,
      final_answer: q(answer.text),
      final_answer_authorship: j(
        answer.parts.map((part) => ({
          participantId: people[part.who].id,
          length: part.text.length,
        }))
      ),
      ready_participant_ids: j(people.map((person) => person.id)),
      submitted_by: q(submittedBy),
      discussion_started_at: q(iso(scenarioStart)),
      final_answer_at: q(iso(submittedAt)),
      submitted: 1,
      created_at: q(iso(scenarioStart)),
      updated_at: q(iso(submittedAt)),
    });

    insert("research_events", {
      id: q(uuid(`event:${spec.code}:start:${scenario.order}`)),
      session_id: q(sessionId),
      participant_id: q(people[0].id),
      event_type: q("scenario_started"),
      payload: j({ scenarioId: `scenario-${String(scenario.order).padStart(2, "0")}`, scenarioOrder: scenario.order }),
      created_at: q(iso(scenarioStart)),
    });

    for (const message of messages) {
      insert("discussion_messages", {
        id: q(message.id),
        session_id: q(sessionId),
        participant_id: q(people[message.who].id),
        scenario_order: scenario.order,
        text: q(message.text),
        created_at: q(iso(message.at)),
      });
    }

    for (const request of aiEvents) {
      const toggled = request.selected ? request.at + 4_000 : request.at + 35_000;
      insert("individual_scaffolds", {
        id: q(request.id),
        session_id: q(sessionId),
        participant_id: q(people[request.who].id),
        scenario_order: scenario.order,
        scaffolding_type: q(request.type),
        ai_response: q(request.response),
        ai_prompt_system: q(
          "Learning support for one student in a research study. Scaffold the group; do not take over the task."
        ),
        ai_prompt_user: q(
          `Scenario ${scenario.order}. Group discussion so far and the answer written so far were included.`
        ),
        ai_model: q("gpt-6-luna"),
        ai_latency_ms: request.latency,
        selected: request.selected ? 1 : 0,
        times_selected: request.selected ? 1 : 1,
        times_unselected: request.selected ? 0 : 1,
        created_at: q(iso(request.at)),
        last_toggled_at: q(iso(toggled)),
      });
      insert("research_events", {
        id: q(uuid(`event:${spec.code}:ai:${scenario.order}:${request.type}:${request.who}`)),
        session_id: q(sessionId),
        participant_id: q(people[request.who].id),
        event_type: q("ai_support_requested"),
        payload: j({
          scenarioOrder: scenario.order,
          scaffoldingType: request.type,
          mocked: false,
          model: "gpt-6-luna",
          latencyMs: request.latency,
        }),
        created_at: q(iso(request.at + request.latency)),
      });
      if (!request.selected) {
        insert("research_events", {
          id: q(uuid(`event:${spec.code}:hide:${scenario.order}:${request.type}:${request.who}`)),
          session_id: q(sessionId),
          participant_id: q(people[request.who].id),
          event_type: q("ai_support_unselected"),
          payload: j({ scenarioOrder: scenario.order, scaffoldingType: request.type }),
          created_at: q(iso(toggled)),
        });
      }
    }

    let typedAt = (firstAi ?? scenarioStart) + 70_000;
    for (const part of answer.parts) {
      typedAt += 45_000;
      insert("edit_events", {
        id: q(uuid(`edit:${spec.code}:${scenario.order}:${part.who}:${part.text.length}`)),
        session_id: q(sessionId),
        participant_id: q(people[part.who].id),
        scenario_order: scenario.order,
        field: q("finalAnswer"),
        chars_added: part.text.length,
        chars_removed: part.who === answer.parts[0].who ? 12 : 0,
        inserted_text: q(part.text.trim()),
        created_at: q(iso(Math.min(typedAt, readyAt[0].at - 20_000))),
      });
    }

    readyAt.forEach((ready, index) => {
      insert("research_events", {
        id: q(uuid(`event:${spec.code}:ready:${scenario.order}:${ready.who}`)),
        session_id: q(sessionId),
        participant_id: q(people[ready.who].id),
        event_type: q("participant_ready"),
        payload: j({ scenarioOrder: scenario.order, readyCount: index + 1, memberCount: 3 }),
        created_at: q(iso(ready.at)),
      });
    });
    insert("research_events", {
      id: q(uuid(`event:${spec.code}:submitted:${scenario.order}`)),
      session_id: q(sessionId),
      participant_id: q(submittedBy),
      event_type: q("final_answer_submitted"),
      payload: j({ scenarioOrder: scenario.order, finalAnswerWords: wordCount }),
      created_at: q(iso(submittedAt)),
    });

    const aiUsers = new Set(aiEvents.map((event) => event.who));
    people.forEach((person, index) => {
      const ratedAt = submittedAt + (index + 1) * 50_000;
      const usedAi = aiUsers.has(index);
      const rating = spec.rate(scenario, index, usedAi);
      insert("surveys", {
        id: q(uuid(`survey:${spec.code}:${scenario.order}:${person.name}`)),
        session_id: q(sessionId),
        participant_id: q(person.id),
        scenario_id: q(`scenario-${String(scenario.order).padStart(2, "0")}`),
        perceived_helpfulness: n(usedAi ? rating.helpful : null),
        support_amount: usedAi ? q(rating.amount) : "NULL",
        ai_helped_discussion: n(usedAi ? rating.discussion : null),
        ai_helped_focus: n(usedAi ? rating.focus : null),
        ai_helped_inclusion: n(usedAi ? rating.inclusion : null),
        ai_helped_disagreement: n(usedAi ? rating.disagreement : null),
        collaboration_rating: rating.collaboration,
        shared_answer_rating: rating.shared,
        autonomy_rating: rating.autonomy,
        ai_helped_thinking: n(usedAi ? rating.thinking : null),
        over_reliance_rating: n(usedAi ? rating.reliance : null),
        could_answer_without_ai: n(usedAi ? rating.without : null),
        satisfaction_rating: rating.satisfaction,
        open_reflection: q(rating.comment),
        answer_confidence: rating.confidence,
        confidence_reason: q(rating.why),
        do_differently: q(rating.differently),
        created_at: q(iso(ratedAt)),
      });
      insert("research_events", {
        id: q(uuid(`event:${spec.code}:survey:${scenario.order}:${person.name}`)),
        session_id: q(sessionId),
        participant_id: q(person.id),
        event_type: q("survey_submitted"),
        payload: j({ scenarioId: `scenario-${String(scenario.order).padStart(2, "0")}`, answerConfidence: rating.confidence }),
        created_at: q(iso(ratedAt)),
      });
      person.lastRatingAt = ratedAt;
    });

    const rubric = spec.rubric(scenario);
    const rubricAt = submittedAt + 26 * 60 * 60 * 1000;
    insert("rubric_scores", {
      id: q(uuid(`rubric:${spec.code}:${scenario.order}`)),
      attempt_id: q(attemptId),
      answer_type: q("final"),
      rater: q("P. Palat"),
      correctness: rubric[0],
      clarity: rubric[1],
      reasoning: rubric[2],
      completeness: rubric[3],
      use_of_examples: rubric[4],
      depth: rubric[5],
      notes: q(rubricNote(spec.code, scenario.order, rubric)),
      created_at: q(iso(rubricAt)),
      updated_at: q(iso(rubricAt)),
    });

    cursor = Math.max(...people.map((person) => person.lastRatingAt)) + 40_000;
  }

  const finished = cursor + 60_000;
  people.forEach((person) => {
    const profile = spec.profiles[person.index];
    const postAt = finished + profile.postFinishedMin * 60_000;
    const postScore = score(profile.post, POST_CORRECT);
    insert("assessments", {
      id: q(uuid(`assessment:${spec.code}:${person.name}:post`)),
      session_id: q(sessionId),
      participant_id: q(person.id),
      assessment_type: q("post"),
      answers: j(answersJson(POST_IDS, profile.post)),
      open_answers: j({
        open_collaboration: profile.postOpen[0],
        open_ai_role: profile.postOpen[1],
      }),
      score: postScore,
      max_score: 8,
      completed_at: q(iso(postAt)),
    });
    insert("research_events", {
      id: q(uuid(`event:${spec.code}:post:${person.name}`)),
      session_id: q(sessionId),
      participant_id: q(person.id),
      event_type: q("assessment_completed"),
      payload: j({ assessmentType: "post", score: postScore, maxScore: 8 }),
      created_at: q(iso(postAt)),
    });
    const reflectionAt = postAt + profile.reflectionMin * 60_000;
    insert("final_reflections", {
      id: q(uuid(`reflection:${spec.code}:${person.name}`)),
      session_id: q(sessionId),
      participant_id: q(person.id),
      answers: j(profile.reflection),
      created_at: q(iso(reflectionAt)),
    });
    insert("research_events", {
      id: q(uuid(`event:${spec.code}:reflection:${person.name}`)),
      session_id: q(sessionId),
      participant_id: q(person.id),
      event_type: q("final_reflection_submitted"),
      payload: j(null),
      created_at: q(iso(reflectionAt)),
    });
    person.doneAt = reflectionAt;
  });

  const completedAt = Math.max(...people.map((person) => person.doneAt));
  const marker = sql.findIndex((line) => line.includes("'COMPLETED_AT'") && line.includes(spec.code));
  sql[marker] = sql[marker].replace("'COMPLETED_AT'", q(iso(completedAt)));
}

function rubricNote(code, order, scores) {
  const total = scores.reduce((sum, value) => sum + value, 0);
  if (code === "GROUP-PNGT") {
    return order >= 9
      ? `Short answer (${total}/24). Less direct copying than their earlier scenarios, still thin reasoning.`
      : `Short answer (${total}/24). Mostly one student, close to the full AI wording.`;
  }
  return order <= 4
    ? `Shared answer (${total}/24). Clear, but several phrases come from the full AI answer.`
    : `Shared answer (${total}/24). More of the group's own reasoning as the AI help gets lighter.`;
}

const hint =
  "Before you answer, check whether every member could explain the result, or only the part they wrote.";

const team1Scenarios = [
  {
    order: 1,
    ready: [0, 1, 2],
    readyAt: 340,
    chat: [
      [0, 25, "so group work is not just splitting the assignment right?"],
      [1, 48, "idk, just get the ai. a hint wont tell us what to write"],
      [2, 70, "ok"],
      [0, 210, "hint was useless. i took the full answer and shortened it"],
    ],
    ai: [
      { who: 0, type: "hint", at: 95, selected: false, latency: 1100, response: hint },
      {
        who: 0,
        type: "full_answer",
        at: 160,
        selected: true,
        latency: 1800,
        response:
          "Collaborative learning means members build a shared understanding together and are jointly responsible for the result. Dividing the assignment into separate parts can finish the page faster, but then nobody can explain the whole answer.",
      },
    ],
    segments: [
      {
        who: 0,
        text: "Collaborative learning means members build a shared understanding together. Dividing the assignment into separate parts is faster, but then nobody can explain the whole answer.",
      },
    ],
  },
  {
    order: 2,
    allThree: true,
    ready: [1, 0, 2],
    readyAt: 420,
    chat: [
      [1, 30, "the weak answer only says splitting makes it faster"],
      [0, 55, "thats incomplete. ask ai for the full thing, hints dont help"],
      [2, 80, "what do i add?"],
      [0, 250, "put one line each. i already have the ai text"],
    ],
    ai: [
      { who: 0, type: "hint", at: 110, selected: false, latency: 900, response: "Which benefits of working together are missing from that sentence?" },
      {
        who: 0,
        type: "full_answer",
        at: 175,
        selected: true,
        latency: 2100,
        response:
          "The answer is incomplete because it treats speed as the only benefit. Collaborative learning also means explaining ideas to each other and being accountable for the whole result. Splitting the work can reduce learning when members never discuss what the others wrote.",
      },
    ],
    segments: [
      { who: 0, text: "The answer is incomplete because it treats speed as the only benefit." },
      { who: 1, text: "We also need explaining ideas to each other." },
      { who: 2, text: "Splitting the work can reduce learning." },
    ],
  },
  {
    order: 3,
    ready: [0, 2, 1],
    readyAt: 360,
    chat: [
      [0, 40, "one person does nothing and one takes over. which option?"],
      [1, 70, "dont debate, full answer"],
      [2, 95, "roles?"],
      [0, 230, "ai says peer assessment. i wrote that"],
    ],
    ai: [
      {
        who: 0,
        type: "full_answer",
        at: 130,
        selected: true,
        latency: 1600,
        response:
          "Recommend peer assessment of contributions. Assigned roles help a little, and an individual quiz checks learning, but peer assessment makes the free-rider visible and keeps the person who takes over from deciding everything alone.",
      },
    ],
    segments: [
      {
        who: 0,
        text: "Recommend peer assessment of contributions. It makes the free-rider visible and stops one person deciding everything alone. Roles and a quiz help less.",
      },
    ],
  },
  {
    order: 4,
    ready: [1, 0, 2],
    readyAt: 300,
    chat: [
      [1, 20, "project is tomorrow. just submit the ai answer?"],
      [0, 45, "the hint wont decide it. full answer"],
      [2, 60, "fine"],
      [1, 200, "i copied the short version"],
    ],
    ai: [
      { who: 1, type: "hint", at: 80, selected: false, latency: 1000, response: "What is the cost to learning if nobody reads the answer?" },
      {
        who: 1,
        type: "full_answer",
        at: 140,
        selected: true,
        latency: 1500,
        response:
          "Submitting a full AI answer the group has not read is not acceptable. Time pressure does not replace honesty or learning. A full AI answer could be justified only as a comparison after the group has already written its own reasoning.",
      },
    ],
    segments: [
      {
        who: 1,
        text: "Submitting a full AI answer the group has not read is not acceptable. Time pressure is not enough. Only ok as a comparison after our own reasoning.",
      },
    ],
  },
  {
    order: 5,
    ready: [0, 1, 2],
    readyAt: 330,
    chat: [
      [0, 35, "shared doc, roles, or ai. i dont want a hint"],
      [1, 60, "full answer again"],
      [0, 200, "done, ai says shared document"],
    ],
    ai: [
      {
        who: 0,
        type: "full_answer",
        at: 100,
        selected: true,
        latency: 1700,
        response:
          "Prioritise a shared online document with edit history. It makes contributions visible. Structured roles are useful next, but an AI assistant should not be the first support because groups may let it write the answer.",
      },
    ],
    segments: [
      {
        who: 0,
        text: "Prioritise a shared online document with edit history because contributions are visible. Roles second. AI assistant should not be first or the group lets it write the answer.",
      },
    ],
  },
  {
    order: 6,
    ready: [2, 0, 1],
    readyAt: 280,
    chat: [
      [2, 30, "i can write this one"],
      [0, 55, "ok but check the full answer first, hints are nothing"],
      [1, 80, "agree"],
    ],
    ai: [
      {
        who: 0,
        type: "full_answer",
        at: 110,
        selected: true,
        latency: 1400,
        response:
          "What helped was explaining the stuck point to each other. What hindered was waiting for one person to finish the section alone. Next time the group should stop and retell the idea before moving on.",
      },
    ],
    segments: [
      {
        who: 2,
        text: "What helped was explaining the stuck point to each other. Waiting for one person hindered us. Next time stop and retell the idea.",
      },
    ],
  },
  {
    order: 7,
    ready: [0, 1, 2],
    readyAt: 350,
    chat: [
      [0, 25, "allow, restrict or ban ai?"],
      [1, 50, "full answer, im not writing from a hint"],
      [2, 75, "ban?"],
      [0, 220, "ai says restrict. pasted a short version"],
    ],
    ai: [
      { who: 0, type: "hint", at: 90, selected: false, latency: 800, response: "Where does support become substitution?" },
      {
        who: 0,
        type: "full_answer",
        at: 145,
        selected: true,
        latency: 2000,
        response:
          "The institution should restrict AI in group projects, not ban it and not allow unrestricted use. AI may support planning and feedback, but unrestricted use lets a group submit work no member engaged with.",
      },
    ],
    segments: [
      {
        who: 0,
        text: "The institution should restrict AI in group projects. Not a ban and not unrestricted use. AI may support feedback, but not work no member engaged with.",
      },
    ],
  },
  {
    order: 8,
    ready: [1, 2, 0],
    readyAt: 340,
    chat: [
      [1, 30, "groups scored 12% higher but 45% said unfair"],
      [0, 60, "dont guess. full answer"],
      [2, 90, "maybe the strong students chose groups"],
      [1, 210, "i wrote what the ai said, shorter"],
    ],
    ai: [
      {
        who: 1,
        type: "full_answer",
        at: 120,
        selected: true,
        latency: 1900,
        response:
          "The data shows an association, not that group work caused the higher score. Students who chose groups may already have been stronger. The 45% unfair workload shows the average hides unequal participation. We would need to know who chose groups and each member's contribution.",
      },
    ],
    segments: [
      {
        who: 1,
        text: "The data shows an association, not that group work caused the higher score. Students who chose groups may already have been stronger. The 45% unfair workload means participation was unequal.",
      },
    ],
  },
  {
    order: 9,
    allThree: true,
    ready: [0, 1, 2],
    readyAt: 480,
    chat: [
      [0, 40, "no full answer this time. christos said try medium"],
      [1, 70, "ok explanation, not a hint. hints still dont help us"],
      [2, 100, "i can do the fairness line"],
      [0, 300, "we each added a bit"],
    ],
    ai: [
      {
        who: 0,
        type: "explanation",
        at: 150,
        selected: true,
        latency: 1300,
        response:
          "A fair process states the criteria first, such as interest, workload and schedule, then lets members propose and compare options against those criteria. Disagreement should be handled by the criteria, not by the loudest person.",
      },
      {
        who: 1,
        type: "feedback",
        at: 260,
        selected: true,
        latency: 1500,
        response:
          "Strength: you are trying to include everyone. Revise: name the criteria before you assign topics, and say what happens when two people want the same topic.",
      },
    ],
    segments: [
      { who: 0, text: "A fair process states the criteria first, like interest, workload and schedule." },
      { who: 1, text: "Then we compare options against those criteria, not the loudest person." },
      { who: 2, text: "If two want the same topic, use the criteria again." },
    ],
  },
  {
    order: 10,
    ready: [0, 1, 2],
    readyAt: 500,
    chat: [
      [0, 30, "one thing to encourage and one to avoid"],
      [1, 70, "medium help only. i still dont like hints"],
      [2, 110, "you two write it"],
      [0, 320, "ok we used the explanation, not the whole answer"],
    ],
    ai: [
      {
        who: 1,
        type: "explanation",
        at: 160,
        selected: true,
        latency: 1200,
        response:
          "Teachers can encourage AI that asks groups to explain their reasoning, and avoid AI use that replaces the discussion. The useful line is between support and substitution.",
      },
      {
        who: 0,
        type: "example",
        at: 230,
        selected: true,
        latency: 1400,
        response:
          "Like a calculator in maths: fine for checking a step, not fine if nobody can do the problem without it.",
      },
    ],
    segments: [
      { who: 0, text: "Encourage AI that asks the group to explain their reasoning." },
      { who: 1, text: "Avoid AI use that replaces the discussion. Support is not substitution. Like a calculator for checking, not for skipping the problem." },
    ],
  },
];

const team2Scenarios = [
  {
    order: 1,
    ready: [0, 1, 2],
    readyAt: 620,
    chat: [
      [0, 40, "I think collaborative means we build one answer together, not divide chapters."],
      [1, 90, "Dividing is faster though. When does it actually hurt learning?"],
      [2, 140, "When nobody can explain the other parts."],
      [0, 200, "Should we look at a full answer just to compare?"],
      [1, 420, "It is almost the whole answer. Lets keep our own example and not copy all of it."],
      [2, 470, "I added the part about explaining it back."],
    ],
    ai: [
      {
        who: 0,
        type: "full_answer",
        at: 280,
        selected: true,
        latency: 1700,
        response:
          "Collaborative learning means the group builds a shared understanding and every member can explain the result. Dividing the assignment into separate parts only looks efficient. A clear example is a lab report where each person writes one section and nobody can present the whole study.",
      },
    ],
    segments: [
      { who: 0, text: "Collaborative learning means the group builds a shared understanding, not just dividing the assignment into separate parts." },
      { who: 1, text: "It hurts learning when nobody can explain the other parts. In our lab report last term each person wrote one section and the presentation fell apart, because we had never questioned each other's sections." },
      { who: 2, text: "So every member should be able to explain the result in everyday words. If only one person understands it, the group did not learn it together." },
    ],
  },
  {
    order: 2,
    ready: [1, 0, 2],
    readyAt: 640,
    chat: [
      [1, 35, "The weak answer only mentions speed. That feels too small."],
      [0, 80, "Missing: we learn by explaining, and someone can hide if we only split."],
      [2, 130, "I want the full answer to see what we missed."],
      [0, 360, "This full answer is too revealing. It basically wrote our revision."],
      [1, 430, "Lets use the missing benefits but write the revision ourselves."],
    ],
    ai: [
      {
        who: 2,
        type: "full_answer",
        at: 200,
        selected: true,
        latency: 2000,
        response:
          "The sentence is misleading because faster work is not the same as learning. Missing benefits are explaining ideas, challenging assumptions and shared responsibility. Splitting the work reduces learning when members never have to defend or revise what the others produced. A better answer would say group work is useful when the group thinks together, not when the page is finished sooner.",
      },
    ],
    segments: [
      { who: 1, text: "Faster work is not the same as learning. The sentence misses explaining ideas, challenging assumptions and shared responsibility." },
      { who: 0, text: "Splitting the work reduces learning when nobody has to defend what the others produced, so a weak member can hide inside a finished page." },
      { who: 2, text: "We would revise it to: group work is useful when the group thinks together and every person can explain the result, not when the page is finished sooner." },
    ],
  },
  {
    order: 3,
    ready: [0, 2, 1],
    readyAt: 700,
    chat: [
      [0, 40, "Free-rider and someone who takes over. Three options."],
      [1, 100, "Peer assessment makes the free-rider visible, but it can become a popularity vote."],
      [2, 160, "Roles might force the quiet person to speak. A quiz checks if we all learned."],
      [0, 230, "I still want a full model so we can compare our choice."],
      [1, 480, "The model picked peer assessment too quickly. I want the trade-off left in."],
    ],
    ai: [
      {
        who: 0,
        type: "full_answer",
        at: 300,
        selected: true,
        latency: 1800,
        response:
          "Recommend peer assessment of contributions, with assigned roles as a support. An individual quiz checks learning but does not fix the process. Peer assessment makes unequal work visible, while roles stop one member from taking every decision. The risk is that friends rate each other kindly.",
      },
    ],
    segments: [
      { who: 0, text: "We recommend peer assessment of contributions together with assigned roles, not instead of them." },
      { who: 2, text: "The quiz checks learning but it does not fix who does the work. Roles stop one member from taking every decision." },
      { who: 1, text: "The risk is that friends rate each other kindly, so the criteria have to be public. We are not only copying the model answer here." },
    ],
  },
  {
    order: 4,
    ready: [0, 1, 2],
    readyAt: 680,
    chat: [
      [1, 30, "Due tomorrow. One member wants to submit a full AI answer and read it later."],
      [2, 90, "I get the time pressure, but then none of us learned it."],
      [0, 150, "Honesty matters, and it is unfair if other groups actually did the work."],
      [0, 220, "Lets see the expert version, then decide how strong we want to be."],
      [1, 460, "Too revealing again. It gave the conclusion and the conditions. We should keep our own line on time pressure."],
    ],
    ai: [
      {
        who: 0,
        type: "full_answer",
        at: 280,
        selected: true,
        latency: 1600,
        response:
          "It is not acceptable to submit a full AI answer the group has not understood. Time pressure explains the temptation but does not justify it. A full AI answer is justified only as a comparison after the group has written its own position on learning, honesty and fairness.",
      },
    ],
    segments: [
      { who: 0, text: "It is not acceptable to submit a full AI answer the group has not understood. The grade would describe the AI, not what we can explain." },
      { who: 2, text: "Time pressure explains why someone would do it the night before, but it does not justify skipping the learning or hiding the tool from the teacher." },
      { who: 1, text: "We would allow a full AI answer only as a comparison after we had already written our own position on honesty, fairness and what each member actually did." },
    ],
  },
  {
    order: 5,
    ready: [1, 0, 2],
    readyAt: 640,
    chat: [
      [0, 40, "No full answer this time. We already saw that it writes the conclusion for us."],
      [1, 110, "Criteria first: learning, participation, fairness, effort."],
      [2, 180, "Shared document shows who wrote what. Roles share the talk. AI is useful but we just watched it take over."],
      [0, 260, "Explanation and an example, not the choice itself."],
      [1, 460, "Good. The example is about study methods, not our three options. We can choose."],
    ],
    ai: [
      {
        who: 0,
        type: "explanation",
        at: 300,
        selected: true,
        latency: 1200,
        response:
          "Choosing well means defining what best means before comparing. A support is stronger when it makes participation visible and still leaves the decision with the group.",
      },
      {
        who: 1,
        type: "example",
        at: 360,
        selected: true,
        latency: 1400,
        response:
          "Analogy, not the answer: students comparing three study methods usually list their constraints first, then drop the option that fails the most important constraint.",
      },
    ],
    segments: [
      { who: 1, text: "Best means learning and fair participation, not the least effort. We listed those criteria before comparing." },
      { who: 0, text: "A shared document with edit history makes participation visible, and the decision stays with us." },
      { who: 2, text: "Roles help the talk, and an AI assistant is useful later, but this activity showed it can take over if it is the first support. So we prioritise the shared document." },
    ],
  },
  {
    order: 6,
    ready: [2, 0, 1],
    readyAt: 600,
    chat: [
      [2, 40, "Last year our group froze on statistics. Silence made it worse."],
      [0, 100, "What helped me was one person explaining the stuck step with a small example."],
      [1, 170, "What failed was splitting the chapter so I never heard their confusion."],
      [0, 240, "Feedback on this, not a full reflection written for us."],
      [1, 430, "It named a strength and one gap. Fair. Ill add the next-time line."],
    ],
    ai: [
      {
        who: 0,
        type: "feedback",
        at: 300,
        selected: true,
        latency: 1500,
        response:
          "Strength: you are using a real class moment, not a vague claim. Revise: say what you would do differently in the first ten minutes, not only what failed.",
      },
    ],
    segments: [
      { who: 2, text: "When we froze on statistics, silence hindered us. One person explaining the stuck step with a small example on the board is what finally helped." },
      { who: 0, text: "Splitting the chapter meant I never heard their confusion, so I could not tell whether my section even fitted theirs." },
      { who: 1, text: "Next time, in the first ten minutes, each person would say what they do not understand before anyone writes, and we would not leave the room until all three could restate it." },
    ],
  },
  {
    order: 7,
    ready: [0, 1, 2],
    readyAt: 660,
    chat: [
      [1, 30, "Allow, restrict or ban. I dont want a full answer, we know that pattern now."],
      [0, 90, "Unrestricted means a report no one engaged with. A ban also blocks useful questions."],
      [2, 160, "Restrict: say what the AI may be used for."],
      [0, 230, "A hint and a question only, please."],
      [1, 400, "The question helped. It did not pick the policy for us."],
    ],
    ai: [
      {
        who: 1,
        type: "hint",
        at: 280,
        selected: true,
        latency: 900,
        response: "Look at enforcement: a rule you cannot see being broken will not change what groups do.",
      },
      {
        who: 0,
        type: "guiding_question",
        at: 320,
        selected: true,
        latency: 1000,
        response: "If AI is allowed only for questions and feedback, what evidence would show a group had still done the thinking?",
      },
    ],
    segments: [
      { who: 0, text: "We would restrict AI, not ban it and not leave it unrestricted. Unrestricted use lets a group submit a report no member engaged with, and a ban also blocks useful questions." },
      { who: 1, text: "The line is questions and feedback, not a finished report. A rule we cannot see being broken will not change what groups do, so the group should be able to show its draft history." },
      { who: 2, text: "Evidence the group still thought: we can explain the answer without the AI window open." },
    ],
  },
  {
    order: 8,
    ready: [2, 1, 0],
    readyAt: 640,
    chat: [
      [2, 40, "12% higher, but 45% called the workload unfair. I dont want to jump."],
      [0, 110, "Maybe stronger students chose groups. That would raise the score without the group teaching them."],
      [1, 180, "And the 45% means the average hides who did the work."],
      [0, 250, "One guiding question, nothing else."],
      [1, 420, "Good question. It didnt hand us the conclusion."],
    ],
    ai: [
      {
        who: 0,
        type: "guiding_question",
        at: 300,
        selected: true,
        latency: 850,
        response: "What would you need to know about who chose the groups before you treat 12% as an effect of collaboration?",
      },
    ],
    segments: [
      { who: 2, text: "The 12% is an association, not proof that group work caused the higher score. The study does not say the groups were formed at random." },
      { who: 0, text: "Students who chose groups may already have been stronger or more motivated, so we would need their earlier scores before calling this an effect of collaboration." },
      { who: 1, text: "The 45% who called the workload unfair show that the average hides unequal participation. We would also want each member's contribution, not only the group exam score." },
    ],
  },
  {
    order: 9,
    ready: [0, 2, 1],
    readyAt: 620,
    chat: [
      [0, 40, "Four people, different strengths and schedules. Design the process, not the topics."],
      [2, 110, "First publish the constraints. Then people propose. Then we check workload."],
      [1, 180, "If we disagree, go back to the criteria instead of voting by confidence."],
      [2, 240, "I can take a hint only if we are actually stuck. I dont think we are."],
      [0, 300, "Agreed. No AI on this one unless someone is blocked."],
      [1, 360, "Not blocked. Lets write."],
    ],
    ai: [
      {
        who: 2,
        type: "hint",
        at: 250,
        selected: false,
        latency: 800,
        response: "A process is fairer when the criteria are visible before anyone claims a topic.",
      },
    ],
    segments: [
      { who: 0, text: "The process is transparent: everyone writes down strengths and schedule limits first, before any topic is claimed." },
      { who: 2, text: "Then each person proposes two topics they can actually prepare, and we compare the set against an even workload." },
      { who: 1, text: "If we disagree, we return to those criteria instead of giving the topic to the most confident person. The hint was not needed; we hid it." },
    ],
  },
  {
    order: 10,
    ready: [1, 0, 2],
    readyAt: 700,
    chat: [
      [1, 30, "Final one. One practice to encourage, one to avoid. I dont think we need AI."],
      [0, 90, "Encourage private hints or questions. Avoid a full answer before the group has a draft."],
      [2, 160, "From today: early on the full answer was too much, and the later hints were enough."],
      [0, 230, "Also encourage that everyone can explain the answer, because that is what we failed to do when we copied."],
      [1, 300, "And avoid counting a pasted AI paragraph as a contribution."],
      [2, 360, "Ill write the encourage part, you two the avoid part."],
    ],
    ai: [],
    segments: [
      { who: 2, text: "Encourage AI that asks the group a question or gives a hint after a draft exists, because today that was enough once we knew the topic." },
      { who: 0, text: "Also encourage holding the answer until every member can explain it. Early on we could not, because the full answer arrived first." },
      { who: 1, text: "Avoid treating a full AI answer as the group's work. A pasted paragraph looks finished and stops the discussion, which is the practice we would drop." },
    ],
  },
];

function phase(order) {
  if (order <= 4) return "full";
  if (order <= 6) return "medium";
  if (order <= 9) return "light";
  return "none";
}

function rateTeam1(scenario, person, usedAi) {
  const late = scenario.order >= 9;
  const wrote = scenario.segments.some((segment) => segment.who === person);
  return {
    helpful: late ? 3 : 5,
    amount: "appropriate",
    discussion: late ? 3 : 2,
    focus: 4,
    inclusion: 2,
    disagreement: scenario.order === 4 || scenario.order === 7 ? 2 : null,
    collaboration: wrote && scenario.allThree ? 3 : 2,
    shared: scenario.allThree ? 3 : 2,
    autonomy: late ? 3 : 2,
    thinking: late ? 3 : 2,
    reliance: late ? 3 : 5,
    without: late ? 3 : 1,
    satisfaction: late ? 3 : 4,
    confidence: wrote ? (late ? 4 : 3) : 2,
    why: wrote
      ? late
        ? "The explanation matched what we said, so I trust it more than the copied ones."
        : "It matches the full AI answer, but I am not sure I could explain every line."
      : "I did not really write it, so I am only slightly confident.",
    differently: late
      ? "Start with the explanation earlier, not only on the last tasks."
      : "Not bother with the small hint. It never helped, just ask for the full answer sooner.",
    comment: !usedAi
      ? "I did not open the AI. The person who did said the hint was useless."
      : late
        ? "The explanation was ok. A small hint would still not have been enough for me."
        : "Satisfied with the full answer. Minimal help does not tell us what to write.",
  };
}

function rateTeam2(scenario, person, usedAi) {
  const kind = phase(scenario.order);
  const tooMuch = scenario.order === 2 || scenario.order === 4;
  const confidence = kind === "full" ? 3 : kind === "medium" ? 4 : 5;
  return {
    helpful: kind === "full" ? 4 : 5,
    amount: tooMuch ? "too_much" : kind === "light" && scenario.order === 8 ? "too_little" : "appropriate",
    discussion: kind === "full" ? 3 : 5,
    focus: 4,
    inclusion: kind === "full" ? 3 : 4,
    disagreement: scenario.order === 3 || scenario.order === 7 ? 4 : null,
    collaboration: kind === "full" ? 4 : 5,
    shared: 5,
    autonomy: kind === "full" ? 2 : kind === "medium" ? 4 : 5,
    thinking: kind === "full" ? 2 : 5,
    reliance: kind === "full" ? 4 : kind === "medium" ? 3 : 2,
    without: kind === "full" ? 2 : kind === "medium" ? 4 : 5,
    satisfaction: tooMuch ? 3 : 5,
    confidence: person === 2 && kind === "full" ? confidence - 1 : confidence,
    why:
      kind === "full"
        ? "We checked it, but a lot of the wording came from the full answer, so I am only moderately confident."
        : kind === "none"
          ? "We wrote this one ourselves and each of us can explain our part."
          : "We had already agreed the main point before the lighter help, so I trust it.",
    differently:
      kind === "full"
        ? "Discuss longer and write a draft before asking for a full answer. It was too revealing."
        : kind === "none"
          ? "Keep doing it this way. We did not need the AI."
          : "Ask for one hint only after we are stuck, which is close to what we did.",
    comment: !usedAi
      ? scenario.order === 10
        ? "No AI this time. The discussion was enough."
        : "I did not select AI. The hint someone opened was not necessary, so it was hidden."
      : tooMuch
        ? "The full answer was too revealing. It handed us the conclusion."
        : kind === "full"
          ? "Useful, but we have to be careful not to paste it."
          : kind === "medium"
            ? "Better. It helped us improve our own draft instead of replacing it."
            : "A hint was enough. We already knew the direction.",
  };
}

function rubricTeam1(scenario) {
  if (scenario.order >= 9) return [3, 3, 2, 2, 2, 2];
  if (scenario.order === 2) return [2, 2, 2, 2, 1, 1];
  return [2, 2, 1, 2, 1, 1];
}

function rubricTeam2(scenario) {
  if (scenario.order <= 2) return [3, 3, 2, 3, 2, 2];
  if (scenario.order <= 4) return [3, 3, 3, 3, 3, 2];
  if (scenario.order <= 8) return [4, 3, 3, 3, 3, 3];
  return [4, 4, 4, 3, 3, 4];
}

const team1 = {
  code: "GROUP-PNGT",
  start: "2026-10-29T07:00:00.000Z",
  names: ["Panagiotis", "Christos", "Papouris"],
  answerWords: [12, 60],
  rarelyAllThree: true,
  scenarios: team1Scenarios,
  rate: rateTeam1,
  rubric: rubricTeam1,
  profiles: [
    {
      pre: [0, 1, 0, 2, 1, 0, 3, 1],
      preScore: 3,
      preFinishedMin: 8,
      preOpen: ["helping each other i guess", "just ask the ai when we dont know"],
      post: [2, 0, 3, 0, 0, 1, 0, 0],
      postScore: 5,
      postFinishedMin: 2,
      postOpen: [
        "Collaborative means we talk and everyone can explain the answer, not only split the pages.",
        "AI can give the answer but the group should still say it in our own words. We did not always do that.",
      ],
      reflectionMin: 4,
      reflection: {
        ai_effect_on_collaboration: "We waited for the full answer and then I wrote a shorter version. We did not talk much.",
        most_useful_support: "The full expert answer. I knew what to write after that.",
        unhelpful_or_too_much: "Small hints. They never told us what the answer was.",
        thinking_and_reliance: "Yes. On most tasks the AI did the thinking and I shortened it.",
        ai_into_group_answer: "Yes. I put the AI answer into the group box in fewer words.",
        private_vs_shared_ai: "Private was fine, because I was the one using it.",
        participation: "Not really. I wrote almost every answer. The others mostly agreed.",
        agreement_on_answer: "I clicked I am good because it matched the AI, not because we had debated it.",
        learned_most: "Group work is more than splitting, but we still handed the thinking to the AI.",
        suggested_changes: "Hints are not enough for people like us. The full answer is what we actually used.",
      },
    },
    {
      pre: [1, 0, 2, 0, 1, 3, 3, 0],
      preScore: 2,
      preFinishedMin: 11,
      preOpen: ["talking maybe, not only splitting the work", "idk, maybe hints"],
      post: [2, 2, 1, 1, 0, 1, 3, 2],
      postScore: 4,
      postFinishedMin: 4,
      postOpen: [
        "We have to discuss and agree, not just join parts. Otherwise one person writes and the others dont know it.",
        "Use the AI for the idea, then change the words. A full answer is easy to copy.",
      ],
      reflectionMin: 3,
      reflection: {
        ai_effect_on_collaboration: "It made us finish fast. We stopped discussing once the full answer appeared.",
        most_useful_support: "Full expert answer, on the judgement tasks.",
        unhelpful_or_too_much: "The minimal hint. I opened it once and it did not help.",
        thinking_and_reliance: "Often, yes. We were satisfied with the AI text and did not add much.",
        ai_into_group_answer: "Panagiotis did that most times. I did it on the due-tomorrow task.",
        private_vs_shared_ai: "Shared would have been ok too. Only one of us was reading it anyway.",
        participation: "No. Two of us typed on a couple of tasks, and all three only once or twice.",
        agreement_on_answer: "I clicked I am good so we could move on. I had not checked every sentence.",
        learned_most: "Copying a correct answer is not the same as learning it. My post-test was better but still shaky.",
        suggested_changes: "Dont offer such a small hint. It feels like no help.",
      },
    },
    {
      pre: [0, 2, 0, 0, 1, 2, 3, 3],
      preScore: 1,
      preFinishedMin: 6,
      preOpen: ["", ""],
      post: [0, 0, 3, 1, 0, 0, 0, 1],
      postScore: 4,
      postFinishedMin: 6,
      postOpen: [
        "Group work is better if we all say something about the same answer.",
        "Ask the AI when we are stuck, then check if we agree before we submit.",
      ],
      reflectionMin: 2,
      reflection: {
        ai_effect_on_collaboration: "I mostly waited. The AI answer showed up and someone else typed it.",
        most_useful_support: "I did not use much. The full answer the others got was the useful one.",
        unhelpful_or_too_much: "Hints. I saw one and it did not say the answer.",
        thinking_and_reliance: "Yes for the group. I could not have written those answers alone at the start.",
        ai_into_group_answer: "Only a little, on the task where we each added one line.",
        private_vs_shared_ai: "Shared, so I can see what they are reading.",
        participation: "I did not contribute on most answers. I said ok in the chat.",
        agreement_on_answer: "I clicked I am good because they were already done, not because I was sure.",
        learned_most: "I can say now that splitting pages is not real collaboration. I left the first written questions blank because I did not know.",
        suggested_changes: "Give the full answer earlier and say it more simply.",
      },
    },
  ],
};

const team2 = {
  code: "GROUP-MARA",
  start: "2026-10-29T07:12:00.000Z",
  names: ["Maria", "Rafaella", "Konstantina"],
  answerWords: [40, 120],
  rarelyAllThree: false,
  scenarios: team2Scenarios.map((scenario) => ({ ...scenario, allThree: true })),
  rate: rateTeam2,
  rubric: rubricTeam2,
  profiles: [
    {
      pre: [1, 3, 0, 2, 1, 1, 0, 1],
      preScore: 5,
      preFinishedMin: 12,
      preOpen: [
        "Everyone works on the same problem and explains it to each other.",
        "AI should give a push, not the final text.",
      ],
      post: [2, 0, 3, 1, 3, 1, 0, 2],
      postScore: 8,
      postFinishedMin: 3,
      postOpen: [
        "Collaborative learning is building one answer everyone can explain, because the members need each other.",
        "AI should scaffold with a hint or a question so the group still decides the answer.",
      ],
      reflectionMin: 6,
      reflection: {
        ai_effect_on_collaboration: "At the start it shortened the discussion, because the full answer arrived before we had finished talking. Later it got out of the way.",
        most_useful_support: "The guiding question, once we already had a direction. The full answer was useful only as a check.",
        unhelpful_or_too_much: "The full expert answer on the second and fourth tasks. It was too revealing and we nearly pasted it.",
        thinking_and_reliance: "Yes at the beginning. By the last tasks, no. We wrote the recommendation with no AI.",
        ai_into_group_answer: "Early on, yes, some sentences. Later I brought a question back to the chat instead of the wording.",
        private_vs_shared_ai: "Private worked, because I had to explain the idea to the others in the chat. Shared would have been tempting to copy.",
        participation: "Yes, more and more. On every answer all three of us wrote something.",
        agreement_on_answer: "Yes. On the early ones I agreed with the text more than with our own reasoning. On the last ones I agreed because we had argued it.",
        learned_most: "The amount of help should go down as the group understands more. Full answers feel good and teach less.",
        suggested_changes: "Keep the full answer available, but show it only after the group has a draft.",
      },
    },
    {
      pre: [1, 1, 1, 2, 0, 3, 1, 0],
      preScore: 4,
      preFinishedMin: 14,
      preOpen: [
        "We need each other to finish, not just divide the pages.",
        "Use it when we are stuck, then discuss what it said.",
      ],
      post: [2, 0, 3, 1, 1, 1, 0, 2],
      postScore: 7,
      postFinishedMin: 5,
      postOpen: [
        "It is collaborative when we question each other and agree on one answer, not when we paste sections together.",
        "Ask for less direct help over time, and never submit the AI text unchanged.",
      ],
      reflectionMin: 5,
      reflection: {
        ai_effect_on_collaboration: "We talked more after we stopped asking for the full answer. Before that the chat was mostly about whether to copy it.",
        most_useful_support: "Feedback on our own draft. It pointed at a gap without writing the paragraph.",
        unhelpful_or_too_much: "Sometimes the full answer. I said so in the chat on task 2 and task 4.",
        thinking_and_reliance: "On the first four tasks it was close. After that I felt we were doing the thinking.",
        ai_into_group_answer: "I used one or two phrases early, then stopped. I said in the group what the idea was.",
        private_vs_shared_ai: "Private. If everyone saw the full answer, the chat would just be editing it.",
        participation: "Yes. We made sure each answer had all three names in it.",
        agreement_on_answer: "I clicked I am good when I could say the answer without looking. That was not true on task 2.",
        learned_most: "A higher score in a group can hide an unfair workload, and the same is true of an AI answer that looks finished.",
        suggested_changes: "The levels are good. I would add a reminder when the full answer is selected.",
      },
    },
    {
      pre: [1, 0, 0, 0, 1, 2, 3, 1],
      preScore: 3,
      preFinishedMin: 10,
      preOpen: ["Talking together about one answer.", "Not sure. Maybe small hints."],
      post: [2, 0, 3, 0, 1, 1, 0, 2],
      postScore: 6,
      postFinishedMin: 7,
      postOpen: [
        "Collaborative means we question each other and can all explain the result, not divide the work and disappear.",
        "Start with more help if we need it, then use less. Do not copy the AI.",
      ],
      reflectionMin: 4,
      reflection: {
        ai_effect_on_collaboration: "I spoke more in the second half. At the start Maria and Rafaella were comparing the full answer and I was quiet.",
        most_useful_support: "The small hint on the later tasks. I understood those.",
        unhelpful_or_too_much: "The full answer was too much for me. I could not tell which part was ours.",
        thinking_and_reliance: "A bit at the start. Not on the last task, we did not use AI at all.",
        ai_into_group_answer: "I tried not to. On the process task I even hid the hint because we were not stuck.",
        private_vs_shared_ai: "Private is better for me. I need to say the idea out loud or I dont learn it.",
        participation: "Yes by the end. I wrote part of every answer, even if my part was shorter at the beginning.",
        agreement_on_answer: "On the last tasks, yes. Earlier I agreed because the text sounded correct, not because it was mine.",
        learned_most: "I knew some of this before, but I can explain scaffolding better now: help should get smaller.",
        suggested_changes: "Nothing big. The decrease we did ourselves should maybe be suggested by the system.",
      },
    },
  ],
};

for (const scenario of team2.scenarios) {
  if (!scenario.allThree) scenario.allThree = true;
}

buildGroup(team1);
buildGroup(team2);

const header = `-- Demo data for two finished groups. Safe to run more than once:
-- it deletes only GROUP-PNGT and GROUP-MARA, then inserts them again.
-- Other groups in the database are left as they are.
--
-- GROUP-PNGT  Panagiotis, Christos, Papouris
--   29 Oct 2026, from 09:00 UTC+2. Weak pre-test (1-3 of 8). Papouris left the
--   written pre-test blank. Scenarios 1-8 use the full AI answer; 9-10 use
--   medium help. Answers are short. All three write on scenarios 2 and 9 only.
--
-- GROUP-MARA  Maria, Rafaella, Konstantina
--   29 Oct 2026, from 09:12 UTC+2. Pre-test 5, 4 and 3 of 8. Full AI answers on
--   scenarios 1-4, medium on 5-6, minimal on 7-9 (hidden on 9), none on 10.
--   All three write every answer.
--
-- Rubric rows are scored later the same evening by rater "P. Palat".
-- Times are UTC.

PRAGMA foreign_keys = ON;
BEGIN;
DELETE FROM sessions WHERE code IN ('GROUP-PNGT', 'GROUP-MARA');
`;

fs.writeFileSync(outPath, `${header}${sql.join("\n")}\nCOMMIT;\n`);
console.log(`Wrote ${path.basename(outPath)} (${sql.length} inserts)`);
