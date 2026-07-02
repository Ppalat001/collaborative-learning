import assessmentData from "@/data/assessment.json";

export interface AssessmentQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

export interface Assessment {
  title: string;
  description: string;
  questions: AssessmentQuestion[];
}

export type AssessmentType = "pre" | "post";

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
