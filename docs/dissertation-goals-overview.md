# What You Are Trying to Achieve (Big Picture)

This project is the **research platform for your dissertation** on **adaptive AI scaffolding in collaborative learning**.

The core question is not simply "Does AI help students learn?" but:

- **When** should an AI agent support a group?
- **What type** of support helps in which situations?
- How does that support affect **learning**, **collaboration**, **learner autonomy**, and **experience**?

You are building a system where students use a **real collaborative learning tool** (not just answering survey questions about hypotheticals). The AI is a **support agent**, not something that takes over the task or gives final answers by default.

---

## The Research Design (Methodology)

Your study uses an **implementation- and scenario-driven** design:

| Element | Purpose |
|---------|---------|
| **Small groups (2–4 students)** | Real collaboration, not solo work |
| **~10 short scenarios** | Each presents a realistic learning/collaboration problem |
| **Group chooses AI support** | Measures *when* and *what type* of help they want |
| **Constrained AI agent** | Same platform, different scaffolding types — comparable for analysis |
| **Joint final answer** | Shows what the group produced *after* discussion + optional AI |
| **Mixed-methods data** | Numbers + text/logs for quantitative and qualitative analysis |

Scenarios are meant to surface problems like: uncertainty, weak reasoning, lack of progress, unequal participation, disagreement, limited reflection, and possible over-reliance on AI.

---

## What the Software Is Supposed to Do

Think of it as three layers:

### 1. Run the study with real participants

- Researcher creates a session → gets a room code (GROUP-XXXX)
- Students join on their own devices with nicknames
- Group gives consent, does pre-test, works through scenarios, does post-test
- Everything is logged for later analysis

### 2. Enforce the pedagogical / research logic

The activity flow per scenario is intentional:

1. Read scenario
2. Discuss as a group (live shared text)
3. Group chooses ONE scaffolding type (only once per scenario)
4. AI responds according to that type (prompt-constrained)
5. Group continues discussion and writes a final joint answer
6. Brief survey (autonomy, satisfaction, collaboration, helpfulness + optional reflection)

Important design choices:

- **AI does not autopilot** — it scaffolds, it doesn't replace the group
- **Support is chosen by the group** — learner agency
- **One scaffolding request per scenario** — clean data on what they picked
- **Discussion before AI** — you can compare thinking before vs after support

### 3. Collect data for your dissertation analysis

**Quantitative:**

- Pre-test and post-test scores (learning gains)
- Which scaffolding type was chosen per scenario
- Survey ratings (autonomy, satisfaction, collaboration, helpfulness)
- Timing (e.g. how long before they requested AI)

**Qualitative:**

- Group discussion text
- Draft answers
- AI responses (and the prompts used)
- Final group answers
- Open-ended reflections

You export this from `/admin` as CSV for statistical analysis and thematic coding.

---

## The 10 Scaffolding Types (What You Are Comparing)

These map directly to Section 3.5 of your dissertation. Each type has different **prompt rules** so the AI behaves differently:

| Type | Intent |
|------|--------|
| Small hint | Nudge without revealing the answer |
| Guiding question | Prompt reasoning, not solutions |
| Brief explanation | Clarify concepts, not resolve the task |
| Example | Analogous example, not the actual answer |
| Feedback | Comment on draft answer — strengths + revisions |
| Summary | Neutral recap of discussion |
| Task splitting | Help divide work fairly |
| Conflict support | Facilitate disagreement productively |
| Full expert answer | Model answer for comparison (dependency risk) |
| No assistance | Control condition |

Your analysis can relate **scenario type + scaffolding choice + outcomes** (answer quality, survey scores, learning gain, etc.).

---

## The 10 Scenarios (What Groups Actually Do)

Predefined in `src/data/scenarios.json`. Examples:

1. Explaining a concept (photosynthesis)
2. Improving a weak answer
3. Short case study (clinic appointments)
4. Ethical judgment call
5. Choosing among solutions
6. Reflecting on learning
7. Ethical dilemma (AI writing tools)
8. Data interpretation
9. Designing a fair process
10. Synthesis recommendation for teachers

Each is short (~6–10 min discussion), open enough for debate, structured enough to log comparable data.

---

## What YOU Need to Do (Practically)

### Phase A — Build & pilot (where you are now)

- Run the app locally or deploy it
- Pilot with 1–2 real groups (2–4 people each)
- Check: sync works, flow is clear, AI responses match scaffolding type, data exports correctly
- Tune scenarios, prompts, and instructions based on pilot observations

### Phase B — Run the formal study

- Recruit student groups
- Facilitate sessions using the protocol (consent → pre-test → scenarios → post-test)
- Take observation notes (collaboration quality, scaffolding choices, UX issues)
- Export and secure data

### Phase C — Analyze for the dissertation

Answer your research questions using:

- **What support did groups choose, and when?**
- **Did different scaffolding types lead to different outcomes?**
- **How did autonomy, collaboration, and satisfaction vary?**
- **Pre vs post scores** — learning gains?
- **Qualitative themes** in discussion and reflections

---

## End-to-End Picture

**Your dissertation question:** When and how should AI scaffold collaborative learning without hurting agency?

**This app provides:**

- Groups + scenarios
- Choice of scaffolding
- Constrained AI agent
- Joint answers + surveys
- Database + CSV export

**Evidence you collect:**

- Pre/post scores
- Scaffolding choices
- Discussion & AI logs
- Surveys & reflections

**Your analysis:**

- Quantitative stats
- Qualitative coding
- Findings for Chapters 4–5

---

## What Success Looks Like

**For the system:** Groups can collaborate in real time, choose scaffolding, get appropriate AI support, submit joint work, and you can export clean research data.

**For the dissertation:** You can show empirically how groups used adaptive AI scaffolding "in the wild," which types helped or hurt learning/collaboration/autonomy, and design recommendations for AI-supported collaborative learning.

---

## Short Reminder of Your Role During a Session

1. **Create session** and share the code
2. **Explain** the flow (discuss first → choose support → use AI → final answer)
3. **Observe** — don't coach scaffolding choices unless that's part of your design
4. **Export data** after sessions from `/admin`
5. **Analyze** choices, outcomes, and experience for your write-up

---

*Generated from the Collaborative AI Learning System project documentation.*
