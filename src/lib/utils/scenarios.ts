import scenariosData from "@/data/scenarios.json";
import type { Scenario, ScaffoldingType } from "@/lib/types";

export function getScenarios(): Scenario[] {
  return [...scenariosData].sort((a, b) => a.order - b.order) as Scenario[];
}

export function getScenarioByOrder(order: number): Scenario | undefined {
  return getScenarios().find((s) => s.order === order);
}

export function getScenarioById(id: string): Scenario | undefined {
  return getScenarios().find((s) => s.id === id);
}

export function isValidScaffoldingType(value: string): value is ScaffoldingType {
  return [
    "hint",
    "guiding_question",
    "explanation",
    "example",
    "feedback",
    "summary",
    "task_splitting",
    "conflict_support",
    "full_answer",
    "no_assistance",
  ].includes(value);
}
