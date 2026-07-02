/**
 * Generates Dissertation-Research-Goals-Overview.docx from structured content.
 * Run: node scripts/generate-dissertation-docx.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "..", "docs", "Dissertation-Research-Goals-Overview.docx");

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, ...opts })],
  });
}

function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun(text)],
  });
}

function numbered(text) {
  return new Paragraph({
    numbering: { reference: "default-numbering", level: 0 },
    spacing: { after: 80 },
    children: [new TextRun(text)],
  });
}

function table(headers, rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map(
          (h) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
            })
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(cell)] })],
                })
            ),
          })
      ),
    ],
  });
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "default-numbering",
        levels: [
          {
            level: 0,
            format: "decimal",
            text: "%1.",
            alignment: "start",
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {},
      children: [
        heading("What You Are Trying to Achieve"),
        heading("Collaborative AI Learning — Dissertation Research Overview", HeadingLevel.HEADING_2),
        para(
          "This project is the research platform for your dissertation on adaptive AI scaffolding in collaborative learning."
        ),
        para("The core question is not simply \"Does AI help students learn?\" but:", { bold: false }),
        bullet("When should an AI agent support a group?"),
        bullet("What type of support helps in which situations?"),
        bullet(
          "How does that support affect learning, collaboration, learner autonomy, and experience?"
        ),
        para(
          "You are building a system where students use a real collaborative learning tool (not just answering survey questions about hypotheticals). The AI is a support agent, not something that takes over the task or gives final answers by default."
        ),

        heading("The Research Design (Methodology)", HeadingLevel.HEADING_2),
        para("Your study uses an implementation- and scenario-driven design:"),
        table(
          ["Element", "Purpose"],
          [
            ["Small groups (2–4 students)", "Real collaboration, not solo work"],
            ["~10 short scenarios", "Each presents a realistic learning/collaboration problem"],
            ["Group chooses AI support", "Measures when and what type of help they want"],
            [
              "Constrained AI agent",
              "Same platform, different scaffolding types — comparable for analysis",
            ],
            [
              "Joint final answer",
              "Shows what the group produced after discussion + optional AI",
            ],
            [
              "Mixed-methods data",
              "Numbers + text/logs for quantitative and qualitative analysis",
            ],
          ]
        ),
        para(
          "Scenarios are meant to surface problems like: uncertainty, weak reasoning, lack of progress, unequal participation, disagreement, limited reflection, and possible over-reliance on AI."
        ),

        heading("What the Software Is Supposed to Do", HeadingLevel.HEADING_2),
        heading("1. Run the study with real participants", HeadingLevel.HEADING_3),
        bullet("Researcher creates a session → gets a room code (GROUP-XXXX)"),
        bullet("Students join on their own devices with nicknames"),
        bullet("Group gives consent, does pre-test, works through scenarios, does post-test"),
        bullet("Everything is logged for later analysis"),

        heading("2. Enforce the pedagogical / research logic", HeadingLevel.HEADING_3),
        para("The activity flow per scenario is intentional:"),
        numbered("Read scenario"),
        numbered("Discuss as a group (live shared text)"),
        numbered("Group chooses ONE scaffolding type (only once per scenario)"),
        numbered("AI responds according to that type (prompt-constrained)"),
        numbered("Group continues discussion and writes a final joint answer"),
        numbered(
          "Brief survey (autonomy, satisfaction, collaboration, helpfulness + optional reflection)"
        ),
        para("Important design choices:"),
        bullet("AI does not autopilot — it scaffolds, it doesn't replace the group"),
        bullet("Support is chosen by the group — learner agency"),
        bullet("One scaffolding request per scenario — clean data on what they picked"),
        bullet("Discussion before AI — you can compare thinking before vs after support"),

        heading("3. Collect data for your dissertation analysis", HeadingLevel.HEADING_3),
        para("Quantitative:", { bold: true }),
        bullet("Pre-test and post-test scores (learning gains)"),
        bullet("Which scaffolding type was chosen per scenario"),
        bullet("Survey ratings (autonomy, satisfaction, collaboration, helpfulfulness)"),
        bullet("Timing (e.g. how long before they requested AI)"),
        para("Qualitative:", { bold: true }),
        bullet("Group discussion text"),
        bullet("Draft answers"),
        bullet("AI responses (and the prompts used)"),
        bullet("Final group answers"),
        bullet("Open-ended reflections"),
        para("You export this from /admin as CSV for statistical analysis and thematic coding."),

        heading("The 10 Scaffolding Types (What You Are Comparing)", HeadingLevel.HEADING_2),
        para(
          "These map directly to Section 3.5 of your dissertation. Each type has different prompt rules so the AI behaves differently:"
        ),
        table(
          ["Type", "Intent"],
          [
            ["Small hint", "Nudge without revealing the answer"],
            ["Guiding question", "Prompt reasoning, not solutions"],
            ["Brief explanation", "Clarify concepts, not resolve the task"],
            ["Example", "Analogous example, not the actual answer"],
            ["Feedback", "Comment on draft answer — strengths + revisions"],
            ["Summary", "Neutral recap of discussion"],
            ["Task splitting", "Help divide work fairly"],
            ["Conflict support", "Facilitate disagreement productively"],
            ["Full expert answer", "Model answer for comparison (dependency risk)"],
            ["No assistance", "Control condition"],
          ]
        ),
        para(
          "Your analysis can relate scenario type + scaffolding choice + outcomes (answer quality, survey scores, learning gain, etc.)."
        ),

        heading("The 10 Scenarios (What Groups Actually Do)", HeadingLevel.HEADING_2),
        para("Predefined in src/data/scenarios.json. Examples:"),
        numbered("Explaining a concept (photosynthesis)"),
        numbered("Improving a weak answer"),
        numbered("Short case study (clinic appointments)"),
        numbered("Ethical judgment call"),
        numbered("Choosing among solutions"),
        numbered("Reflecting on learning"),
        numbered("Ethical dilemma (AI writing tools)"),
        numbered("Data interpretation"),
        numbered("Designing a fair process"),
        numbered("Synthesis recommendation for teachers"),
        para(
          "Each is short (~6–10 min discussion), open enough for debate, structured enough to log comparable data."
        ),

        heading("What YOU Need to Do (Practically)", HeadingLevel.HEADING_2),
        heading("Phase A — Build & pilot (where you are now)", HeadingLevel.HEADING_3),
        bullet("Run the app locally or deploy it"),
        bullet("Pilot with 1–2 real groups (2–4 people each)"),
        bullet(
          "Check: sync works, flow is clear, AI responses match scaffolding type, data exports correctly"
        ),
        bullet("Tune scenarios, prompts, and instructions based on pilot observations"),

        heading("Phase B — Run the formal study", HeadingLevel.HEADING_3),
        bullet("Recruit student groups"),
        bullet("Facilitate sessions using the protocol (consent → pre-test → scenarios → post-test)"),
        bullet("Take observation notes (collaboration quality, scaffolding choices, UX issues)"),
        bullet("Export and secure data"),

        heading("Phase C — Analyze for the dissertation", HeadingLevel.HEADING_3),
        para("Answer your research questions using:"),
        bullet("What support did groups choose, and when?"),
        bullet("Did different scaffolding types lead to different outcomes?"),
        bullet("How did autonomy, collaboration, and satisfaction vary?"),
        bullet("Pre vs post scores — learning gains?"),
        bullet("Qualitative themes in discussion and reflections"),

        heading("End-to-End Picture", HeadingLevel.HEADING_2),
        para("Your dissertation question:", { bold: true }),
        para(
          "When and how should AI scaffold collaborative learning without hurting agency?"
        ),
        para("This app provides:", { bold: true }),
        bullet("Groups + scenarios"),
        bullet("Choice of scaffolding"),
        bullet("Constrained AI agent"),
        bullet("Joint answers + surveys"),
        bullet("Database + CSV export"),
        para("Evidence you collect:", { bold: true }),
        bullet("Pre/post scores"),
        bullet("Scaffolding choices"),
        bullet("Discussion & AI logs"),
        bullet("Surveys & reflections"),
        para("Your analysis:", { bold: true }),
        bullet("Quantitative stats"),
        bullet("Qualitative coding"),
        bullet("Findings for Chapters 4–5"),

        heading("What Success Looks Like", HeadingLevel.HEADING_2),
        para("For the system:", { bold: true }),
        para(
          "Groups can collaborate in real time, choose scaffolding, get appropriate AI support, submit joint work, and you can export clean research data."
        ),
        para("For the dissertation:", { bold: true }),
        para(
          "You can show empirically how groups used adaptive AI scaffolding \"in the wild,\" which types helped or hurt learning/collaboration/autonomy, and design recommendations for AI-supported collaborative learning."
        ),

        heading("Short Reminder of Your Role During a Session", HeadingLevel.HEADING_2),
        numbered("Create session and share the code"),
        numbered("Explain the flow (discuss first → choose support → use AI → final answer)"),
        numbered("Observe — don't coach scaffolding choices unless that's part of your design"),
        numbered("Export data after sessions from /admin"),
        numbered("Analyze choices, outcomes, and experience for your write-up"),

        para(""),
        para("Generated from the Collaborative AI Learning System project documentation.", {
          italics: true,
          size: 20,
        }),
      ],
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buffer);
console.log("Created:", outPath);
