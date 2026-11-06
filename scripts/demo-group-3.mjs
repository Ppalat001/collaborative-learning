/**
 * Third demo group for scripts/generate-demo-seed.mjs.
 *
 * GROUP-N8FJ  Christos, Panahs, Papouris — Monday 2 Nov 2026
 *   Close to GROUP-R4WK: some prior knowledge, full AI answers early, then
 *   less help, shared answers. Differences: the full answer is "too revealing"
 *   on scenarios 1 and 3, Papouris already switches to feedback on scenario 4,
 *   help drops faster after scenario 5 (no AI on 9 and 10), scenario 8 is
 *   written by two of them, and the post-test is a little lower.
 */

const full = (who, at, latency, response) => ({
  who,
  type: "full_answer",
  at,
  selected: true,
  latency,
  response,
});

const help = (who, type, at, latency, response) => ({
  who,
  type,
  at,
  selected: true,
  latency,
  response,
});

const scenarios = [
  {
    order: 1,
    allThree: true,
    ready: [0, 2, 1],
    readyAt: 600,
    chat: [
      [1, 45, "Splitting is what we did in every group project in school, to be honest."],
      [0, 95, "Yes, but then I only knew my part. In the history project I could not answer one question about the other sections."],
      [2, 150, "So the difference is whether we can explain each other's parts?"],
      [0, 215, "Lets each get the full answer and compare with what we said."],
      [2, 410, "Mine has almost exactly our history example. Feels like it gave us everything."],
      [1, 445, "Lets keep our own example then and write it simply, for a first-year."],
    ],
    ai: [
      full(0, 250, 1900, "Dividing work means each member completes a separate piece. Collaborative learning means the group builds understanding together, so every member can explain the whole result. For example, in a history project split into sections, a member who never discussed the other sections cannot answer questions about them."),
      full(1, 268, 2100, "Group work is truly collaborative when members think through the task together rather than only assembling separate parts. A simple test is whether each member could explain any part of the final answer. A project where each person writes one section and never reads the others fails that test."),
      full(2, 300, 1800, "Splitting the assignment finishes the work, but it does not mean the group learned together. In collaborative learning the members discuss, question and connect each other's parts. For example, a history project split into sections leaves each student unable to explain the sections they did not write."),
    ],
    segments: [
      { who: 0, text: "Dividing work means each person finishes a part alone. Learning together means the group talks through every part until all of us understand the whole." },
      { who: 1, text: "Think of a history project where each person writes one section. When the teacher asks about another section, nobody can answer, because nobody discussed it." },
      { who: 2, text: "So group work is truly collaborative when every member can explain the full answer, not just their own piece, in their own words." },
    ],
  },
  {
    order: 2,
    allThree: true,
    ready: [1, 0, 2],
    readyAt: 560,
    chat: [
      [2, 40, "Faster is true, but it is not the point of group work."],
      [1, 100, "Missing: you learn from hearing how the others think."],
      [0, 160, "And splitting reduces learning when the parts depend on each other, like a lab report."],
      [0, 390, "It lists what we had plus accountability. Lets add that one."],
    ],
    ai: [
      full(1, 205, 2000, "The answer is incomplete because it treats speed as the main benefit. Collaborative learning also involves learning from others' reasoning, explaining your own ideas and shared accountability for the result. Splitting can reduce learning when the parts depend on each other and are never compared."),
      full(0, 220, 1700, "Speed is one possible benefit, but the answer misses the main ones: hearing different reasoning, having to explain ideas, and being accountable for the whole result. When parts depend on each other, such as method and results in a lab report, splitting without discussion lowers learning."),
      full(2, 250, 1900, "The statement is misleading because it values finishing over learning. A better answer would mention discussion, explanation and joint responsibility. Splitting reduces learning when members never check how their parts connect."),
    ],
    segments: [
      { who: 1, text: "The answer is incomplete because speed is only one benefit. It misses that we learn from hearing how the others think and from explaining our own ideas." },
      { who: 0, text: "Splitting can even reduce learning when the parts depend on each other, like a lab report where the method and the results are written by different people who never compare." },
      { who: 2, text: "Revised answer: group work is useful when members discuss, question and are accountable for the whole result, not only when it is faster." },
    ],
  },
  {
    order: 3,
    allThree: true,
    ready: [0, 1, 2],
    readyAt: 680,
    chat: [
      [0, 50, "Three options. Peer assessment, roles, or a quiz."],
      [2, 120, "Roles would force the quiet one to do something. The presenter cant hide."],
      [1, 190, "But roles do not stop the one who takes over. The facilitator can still decide everything."],
      [0, 250, "The quiz checks if everyone learned, but it comes too late to fix the project."],
      [1, 470, "This is too revealing, it picks the option and gives the risk too. We had roles, lets not just switch to its choice."],
      [2, 510, "Ok, but its point about rotating the facilitator is fair. We say it in our words."],
    ],
    ai: [
      full(0, 290, 2200, "Recommend assigned roles, with the facilitator role rotating. Roles give the inactive student a visible responsibility, while rotation and a critic role limit the dominant student. Peer assessment is fairer for grading but risks becoming a popularity vote, and a quiz checks learning only after the project."),
      full(2, 300, 2000, "Assigned roles are the strongest option if the facilitator rotates. The inactive student gets a clear task, and the critic can challenge decisions made by one person. Peer assessment helps fairness but can be biased by friendships. A quiz measures learning but does not change participation during the project."),
      full(1, 330, 2300, "Choose roles. They address both problems: the quiet member must contribute and the dominant member shares decisions if the facilitator rotates. Peer assessment may harm students with fewer friends in the group, and the quiz comes too late. The assumption is that the teacher checks that roles are followed."),
    ],
    segments: [
      { who: 2, text: "We recommend assigned roles. The student who does almost nothing gets a clear task, and the presenter or recorder cannot stay invisible." },
      { who: 1, text: "Roles alone do not stop the student who takes over, so the facilitator should rotate and the critic should question decisions before they are final." },
      { who: 0, text: "Peer assessment is fairer for grading but can turn into a popularity vote, and the quiz only shows learning after the project. Our assumption is that the teacher checks the roles are followed." },
    ],
  },
  {
    order: 4,
    allThree: true,
    ready: [2, 0, 1],
    readyAt: 650,
    chat: [
      [1, 35, "Honestly I have done this before when it was late."],
      [2, 85, "But then you present something you cannot defend if the teacher asks."],
      [0, 140, "And it is unfair to the others if one person decides it for everyone."],
      [2, 230, "I will ask for feedback on our draft, not the full answer."],
      [0, 330, "The full answer says only for comparison after our own reasoning. Same as we said."],
      [2, 420, "Feedback says our criteria are good, but we should say what to do if there really is no time."],
    ],
    ai: [
      full(1, 190, 1800, "Submitting a full AI answer that the group has not read is not acceptable. It misrepresents the group's learning and is unfair to members who were not asked. Time pressure explains the temptation but does not justify it. A full AI answer can be justified only as a comparison after the group has formed its own position."),
      full(0, 210, 2000, "No. The grade would describe the AI's work rather than the group's, and one member would be deciding for everyone. Deadlines make this tempting, but honesty and learning matter more. Using a full AI answer is reasonable only to compare against the group's own reasoning."),
      help(2, "feedback", 380, 1500, "Strength: you weigh honesty and fairness, not only the grade. Revise: say what the group should do if there truly is not enough time, so the answer is not only a rule."),
    ],
    segments: [
      { who: 0, text: "It is not acceptable to submit a full AI answer the group has not read. The grade would show the AI's work, not ours, and it is unfair if one member decides for everyone." },
      { who: 1, text: "Time pressure explains the temptation, but it does not justify it. A full AI answer could be used only to compare after we wrote our own position." },
      { who: 2, text: "If there is really no time, the honest option is to ask the teacher for an extension or to submit a shorter answer we understand." },
    ],
  },
  {
    order: 5,
    allThree: true,
    ready: [1, 2, 0],
    readyAt: 600,
    chat: [
      [0, 40, "No full answers from now. We saw it decides for us."],
      [1, 100, "SRL is one student managing their own learning. CoRL is help from another student."],
      [2, 165, "SSRL is all three of us checking the group plan. We need a clear example for each."],
      [1, 230, "Lets use one difficult research assignment for all three examples."],
      [0, 430, "The explanation confirms that the difference is who controls the regulation."],
      [1, 470, "Feedback says connect each example to successful collaboration. Adding that."],
    ],
    ai: [
      help(0, "explanation", 270, 1300, "Distinguish the processes by who regulates learning: the individual in SRL, one person supporting another in CoRL, and the group collectively in SSRL. They can all occur during the same assignment."),
      help(2, "example", 320, 1400, "Analogy, not your answer: one player reviews their own performance, a teammate gives them a corrective prompt, and the whole team reviews its strategy and agrees to change it."),
      help(1, "feedback", 390, 1500, "Strength: you have one example for each level of regulation. Revise: explain how each example contributes to the group's successful learning, not only what happens."),
    ],
    segments: [
      { who: 1, text: "SRL happens when one student notices they do not understand a source, plans to reread it and checks whether their understanding improved." },
      { who: 2, text: "CoRL happens when a teammate asks that student to explain the source and points out a missed assumption, helping the student correct their approach." },
      { who: 0, text: "SSRL happens when all three set a shared goal, monitor whether the assignment is on track and change their plan together. These processes support personal responsibility, peer help and coordinated group progress." },
    ],
  },
  {
    order: 6,
    allThree: true,
    ready: [0, 1, 2],
    readyAt: 560,
    chat: [
      [2, 45, "More messages cannot automatically mean better participation."],
      [1, 110, "One short question can expose a problem that ten repeated points do not."],
      [0, 175, "Writing more may just mean one person became the recorder."],
      [1, 240, "I will ask for feedback on our reasoning. Only feedback, we know the rest."],
      [2, 430, "Feedback says explain how we help each other understand. Lets add that."],
    ],
    ai: [
      help(1, "feedback", 290, 1600, "Strength: you distinguish contribution quantity from contribution value. Revise: explain how members respond to a useful contribution and turn it into shared understanding."),
    ],
    segments: [
      { who: 2, text: "Contributing more messages or text does not necessarily mean participating more meaningfully. A quiet member may ask one question that reveals a mistaken assumption." },
      { who: 1, text: "A valuable contribution moves the group's understanding forward by explaining a reason, connecting ideas, challenging a claim or inviting another member to clarify." },
      { who: 0, text: "Members help one another by listening, asking follow-up questions, giving constructive feedback and checking that everyone can explain the shared answer, even when their visible contributions are unequal." },
    ],
  },
  {
    order: 7,
    allThree: true,
    ready: [1, 0, 2],
    readyAt: 620,
    chat: [
      [1, 40, "Ban is impossible to check. People will use it at home."],
      [0, 100, "Unrestricted means some groups never read their own report."],
      [2, 160, "So restrict, but how do we check it?"],
      [0, 220, "Asking for one hint only."],
      [2, 390, "The question was good: what evidence shows the group did the thinking. Draft history and a short oral check."],
    ],
    ai: [
      help(0, "hint", 250, 900, "Think about what a teacher can actually see after the report is submitted."),
      help(2, "guiding_question", 280, 1000, "What evidence would show that the group, and not the tool, did the thinking?"),
    ],
    segments: [
      { who: 0, text: "We would restrict AI in group projects. A ban cannot be enforced, and unrestricted use lets a group submit a report no member engaged with." },
      { who: 2, text: "The line between support and substitution is whether the group can show its own thinking: a draft history and a short oral check where any member explains the report." },
      { who: 1, text: "AI may be used for questions, hints and feedback, but each member's contribution should still be visible, so the grade stays fair." },
    ],
  },
  {
    order: 8,
    allThree: false,
    ready: [2, 1, 0],
    readyAt: 600,
    chat: [
      [0, 40, "12% higher sounds like groups work better."],
      [2, 95, "Not necessarily. Maybe only motivated students joined groups."],
      [1, 155, "And 45% unfair means some people did more. Did they score higher?"],
      [0, 215, "We dont know that from the data. That is the point."],
      [2, 260, "I am not sure what extra data to ask for."],
      [1, 400, "Hint says compare students who had similar grades before. Thats the data we want."],
      [0, 430, "Mine asked what we would need to rule out. Same idea, earlier grades."],
    ],
    ai: [
      help(1, "hint", 300, 850, "Look for a way to compare students who were similar before the course started."),
      help(0, "guiding_question", 335, 950, "What would you need to know about the students before the course to rule out that the groups were simply stronger?"),
    ],
    segments: [
      { who: 0, text: "No. The data shows that group students scored 12% higher, but it does not show that group work caused it, because students chose whether to join groups." },
      { who: 1, text: "Motivated or stronger students may have joined groups. The 45% who felt the workload was unfair also suggests some members did more work. We would want earlier grades for both groups and each member's contribution in the group." },
    ],
  },
  {
    order: 9,
    allThree: true,
    ready: [0, 2, 1],
    readyAt: 560,
    chat: [
      [1, 40, "Four members, different strengths and schedules."],
      [0, 95, "First everyone writes availability and which topics they are good at."],
      [2, 150, "Then everyone picks two topics, and if two people want the same, we compare workload."],
      [1, 210, "What if someone always ends up with the hardest topic?"],
      [0, 260, "Then it rotates. And a check-in halfway, in case the workload changes. I think we dont need AI here."],
    ],
    ai: [],
    segments: [
      { who: 0, text: "No. Exactly one topic each is not always fair because topics vary in difficulty and members have different time and experience. Everyone first writes down availability and strengths." },
      { who: 2, text: "Each member then picks two preferred topics. If two people want the same topic, we compare who has the lighter workload so far." },
      { who: 1, text: "To stay fair, the hardest topic rotates between presentations, and we have a short check-in halfway to see if anyone needs help or the workload changed." },
    ],
  },
  {
    order: 10,
    allThree: true,
    ready: [1, 2, 0],
    readyAt: 520,
    chat: [
      [2, 40, "Last one. We dont need AI for this, we lived it."],
      [0, 90, "Encourage: hints or questions after the group has its own draft."],
      [1, 150, "Avoid: asking for the full answer before discussing. Our first tasks were like that."],
      [2, 210, "It also made me quiet at the start. The AI answer was already better than what I would say."],
      [0, 265, "Good point, put that in as the reason."],
    ],
    ai: [],
    segments: [
      { who: 0, text: "No. Groups should not always follow AI suggestions because the AI may be wrong or may replace their reasoning. A good practice is to request hints or questions after the group has a draft and verify the response before using it." },
      { who: 1, text: "They should avoid letting groups ask for a full AI answer before discussing. In our first tasks the full answer arrived first and the discussion became editing its text." },
      { who: 2, text: "It also makes quieter members stop talking, because the AI answer already sounds better than their own idea." },
    ],
  },
];

const LEVEL = {
  hint: 1,
  guiding_question: 1,
  explanation: 2,
  example: 2,
  feedback: 2,
  full_answer: 3,
};

function rate(scenario, person, usedAi, own) {
  const level = Math.max(0, ...own.filter((r) => r.selected).map((r) => LEVEL[r.type] ?? 0));
  const tooMuch = (scenario.order === 1 || scenario.order === 3) && level === 3;
  const tooLittle = scenario.order === 7 && person === 0;
  const wrote = scenario.segments.some((segment) => segment.who === person);
  const early = scenario.order <= 4;
  let confidence = early ? 3 : scenario.order <= 7 ? 4 : 5;
  if (person === 2 && scenario.order <= 3) confidence -= 1;
  if (!wrote) confidence = 3;

  const pick = (options) => options[person];
  const comment = !usedAi
    ? scenario.order === 10
      ? pick([
          "We did it without AI and it was the best discussion we had.",
          "No AI needed, we knew what we wanted to say.",
          "Without AI I said more than in the first tasks.",
        ])
      : scenario.ai.length === 0
        ? pick([
            "We decided not to use AI. The process was clear to us.",
            "Not needed. We had the rotation idea ourselves.",
            "We talked it through and did not get stuck.",
          ])
        : pick([
          "I did not ask the AI this time; the help the others got was enough.",
          "I let the others ask and we discussed it in the chat.",
          "I did not open it. We talked it through instead.",
        ])
    : tooLittle
      ? "The hint alone was too small. The question Papouris got helped more."
      : tooMuch
        ? scenario.order === 1
          ? pick([
              "It gave away the answer and even our example. Too much.",
              "Too revealing. It already had the history project in it.",
              "Good answer, but it left nothing for us to think about.",
            ])
          : pick([
              "It picked the option and listed the risks. Nothing left to decide.",
              "Too revealing, it basically chose for us.",
              "We had roles already, but after reading it I was not sure it was our choice.",
            ])
        : level === 3
          ? pick([
              "Clear and correct, but we had to put it in our own words.",
              "Useful to compare with what we already said.",
              "It helped me understand, but I would not say it like this.",
            ])
          : level === 2
            ? pick([
                "It pushed us in the right direction without writing it for us.",
                "Better level of help. We still had to decide.",
                "This was enough. It improved our draft.",
              ])
            : pick([
                "One hint was enough, maybe a bit little.",
                "Short and to the point.",
                "The question made us think about what to check.",
              ]);

  return {
    helpful: level === 3 ? 4 : tooLittle ? 3 : 5,
    amount: tooMuch ? "too_much" : tooLittle ? "too_little" : "appropriate",
    discussion: level === 3 ? 3 : 4,
    focus: 4,
    inclusion: level === 3 ? 3 : 4,
    disagreement:
      scenario.order === 3 || scenario.order === 8 ? (level === 3 ? 3 : 4) : null,
    collaboration: !wrote ? 3 : early ? 4 : 5,
    shared: wrote ? 5 : 3,
    autonomy: level === 3 ? 2 : level === 2 ? 4 : 5,
    thinking: level === 3 ? 3 : 4,
    reliance: level === 3 ? 4 : level === 2 ? 3 : 2,
    without: level === 3 ? 2 : level === 2 ? 3 : 4,
    satisfaction: tooMuch ? 3 : tooLittle ? 4 : level === 3 ? 4 : 5,
    confidence,
    why: !wrote
      ? "I did not write it, but I agree with what they wrote."
      : early
        ? pick([
            "We compared it with the full answer, so I think it is right, but some phrases are not ours.",
            "Most of the reasoning is ours. The AI only confirmed it.",
            "I agree with it, but I am not sure I could defend every sentence.",
          ])
        : pick([
            "We agreed on the main point before asking for any help.",
            "We argued about it and the answer reflects that.",
            "I can explain my part and the others' parts.",
          ]),
    differently:
      scenario.order === 10
        ? pick(["Keep it like this.", "Work like this from the first task.", "Speak earlier in the first tasks."])
        : early
          ? pick([
              "Write our own draft first, then look at the full answer.",
              "Discuss longer before asking the AI.",
              "Say my idea before reading the AI answer.",
            ])
          : pick([
              "Not much. Maybe ask for help a bit later.",
              "Use the hint only if we are really stuck.",
              "Write a bigger part myself.",
            ]),
    comment,
  };
}

function rubric(scenario) {
  if (scenario.order <= 2) return [3, 3, 3, 3, 3, 2];
  if (scenario.order <= 4) return [3, 3, 3, 3, 2, 3];
  if (scenario.order <= 7) return [3, 4, 3, 3, 3, 3];
  if (scenario.order === 8) return [3, 3, 3, 2, 2, 3];
  if (scenario.order === 9) return [4, 3, 3, 3, 3, 3];
  return [4, 4, 3, 3, 3, 4];
}

function note(_code, order, scores) {
  const total = scores.reduce((sum, value) => sum + value, 0);
  if (order <= 4) {
    return `${total}/24. Correct and shared, own example included, but structure follows the full AI answer closely.`;
  }
  if (order === 8) {
    return `${total}/24. Good interpretation of causation; additional data only partly specified. Two contributors.`;
  }
  if (order >= 9) return `${total}/24. Group's own reasoning, no AI. Clear and complete.`;
  return `${total}/24. Group's own reasoning, light AI use. Clear and complete.`;
}

export const group3 = {
  code: "GROUP-N8FJ",
  start: "2026-11-02T13:38:52.000Z",
  names: ["Christos", "Panahs", "Papouris"],
  answerWords: [40, 120],
  chatBeforeAi: [1, 6],
  rarelyAllThree: false,
  scenarios,
  rate,
  rubric,
  note,
  profiles: [
    {
      pre: [1, 3, 2, 2, 0, 0, 3, 0],
      preScore: 4,
      preFinishedMin: 11,
      preOpen: [
        "Working on the same thing together and talking about it.",
        "To help when the group is stuck, not do it for us.",
      ],
      post: [2, 0, 3, 1, 2, 0, 2, 3],
      postScore: 7,
      postFinishedMin: 4,
      postOpen: [
        "Members depend on each other and build one answer that everyone can explain, instead of joining separate parts.",
        "AI should give hints, questions or feedback so the group still does the thinking, and less help as we understand more.",
      ],
      reflectionMin: 5,
      reflection: {
        ai_effect_on_collaboration: "On the first tasks it shortened the discussion, because we compared our ideas with the full answer instead of with each other. Later it was a small push and we talked more.",
        most_useful_support: "The guiding question on the data task, and the question Papouris got on the policy task.",
        unhelpful_or_too_much: "The full answer on the case study. It chose the option and even listed the risks, so there was nothing left to decide.",
        thinking_and_reliance: "On tasks 1 to 4 partly. After that we did the thinking and used AI only to check.",
        ai_into_group_answer: "Early on a few phrases. Later I only told the others the idea in the chat.",
        private_vs_shared_ai: "Private. Each of us had to explain what our AI said, which made us talk.",
        participation: "Yes, all three of us wrote in almost every answer. On the data task Papouris did not write but helped in the chat.",
        agreement_on_answer: "Yes on most. On the case study I agreed with roles, but I was not sure we were not just following the AI.",
        learned_most: "Splitting work and learning together are different, and less AI help gave us better discussions.",
        suggested_changes: "Maybe ask the group to write a first draft before the full answer can be opened.",
      },
    },
    {
      pre: [1, 0, 0, 1, 2, 2, 0, 0],
      preScore: 3,
      preFinishedMin: 13,
      preOpen: [
        "Everyone helps and understands the topic, not only their part.",
        "Give ideas or check our work.",
      ],
      post: [2, 0, 1, 1, 2, 0, 1, 0],
      postScore: 6,
      postFinishedMin: 6,
      postOpen: [
        "It is collaborative when we discuss and question each other's ideas and all of us are responsible for the result.",
        "Use it after we have our own idea, to check or get unstuck, not to write the answer.",
      ],
      reflectionMin: 4,
      reflection: {
        ai_effect_on_collaboration: "When everyone opened the full answer we mostly edited its text. When we used hints we argued more.",
        most_useful_support: "The hint on the data task. It told me where to look but not the answer.",
        unhelpful_or_too_much: "The full answer on the first task. It already had our history example in it.",
        thinking_and_reliance: "At the start yes, a bit. From task 5 no.",
        ai_into_group_answer: "On the second task I used some of its wording about accountability.",
        private_vs_shared_ai: "Private is better. If it was shared we would just copy one answer.",
        participation: "Yes. I wrote something in every task, sometimes the longest part.",
        agreement_on_answer: "Mostly yes. I clicked I am good when I could explain it.",
        learned_most: "A 12% better score does not prove group work caused it. You have to ask who joined the groups.",
        suggested_changes: "Show the levels of help with an example, so we know what we get before we choose.",
      },
    },
    {
      pre: [0, 3, 0, 1, 1, 1, 2, 1],
      preScore: 4,
      preFinishedMin: 9,
      preOpen: [
        "When the group discusses and decides together.",
        "Maybe hints, I am not sure.",
      ],
      post: [2, 0, 3, 0, 2, 0, 1, 3],
      postScore: 7,
      postFinishedMin: 3,
      postOpen: [
        "Everyone can explain the whole answer, not only their part, because we talked it through together.",
        "Small help like a question is better. A full answer stops the discussion.",
      ],
      reflectionMin: 6,
      reflection: {
        ai_effect_on_collaboration: "At the start I was quiet, because the full answer already sounded better than my idea. On the later tasks I spoke more.",
        most_useful_support: "Feedback on our draft in task 4. I chose it instead of the full answer and it was enough.",
        unhelpful_or_too_much: "The full answer on the first and third tasks was too much.",
        thinking_and_reliance: "On the first three tasks I relied on it. Not after.",
        ai_into_group_answer: "Not really. I wrote my parts myself, sometimes after reading the AI.",
        private_vs_shared_ai: "Private, but then we must say in the chat what it told us.",
        participation: "I wrote in most answers. In the data task I only discussed, because I did not know what data to ask for.",
        agreement_on_answer: "On the last tasks fully. On the first ones I agreed because the AI said the same.",
        learned_most: "Less help can be better, and quiet members speak more when the AI does not answer first.",
        suggested_changes: "Nothing big. Maybe a reminder that the full answer is for comparison only.",
      },
    },
  ],
};
