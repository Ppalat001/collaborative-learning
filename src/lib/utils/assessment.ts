import assessmentData from "@/data/assessment.json";

export interface AssessmentQuestion {
  id: string;
  /** Pre and post items share a concept, so learning can be compared per concept. */
  concept: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/** Written answers; the pre and post tests ask the same ones so they can be compared. */
export interface OpenQuestion {
  id: string;
  text: string;
}

export interface Assessment {
  title: string;
  description: string;
  questions: AssessmentQuestion[];
  openQuestions: OpenQuestion[];
}

export type AssessmentType = "pre" | "post";

export const OPEN_ANSWER_MAX_LENGTH = 3000;

export function getAssessment(type: AssessmentType): Assessment {
  return type === "pre" ? assessmentData.preTest : assessmentData.postTest;
}

export function scoreAssessment(
  type: AssessmentType,
  answers: Record<string, number>
): { score: number; maxScore: number } {
  const assessment = getAssessment(type);
  let score = 0;
  for (const question of assessment.questions) {
    if (answers[question.id] === question.correctIndex) {
      score += 1;
    }
  }
  return { score, maxScore: assessment.questions.length };
}

export function parseOpenAnswers(
  type: AssessmentType,
  value: unknown
): Record<string, string> {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const answers: Record<string, string> = {};
  for (const question of getAssessment(type).openQuestions) {
    answers[question.id] = String(source[question.id] ?? "")
      .trim()
      .slice(0, OPEN_ANSWER_MAX_LENGTH);
  }
  return answers;
}
