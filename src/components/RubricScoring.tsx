"use client";

import { useState } from "react";
import { RUBRIC_CRITERIA, RUBRIC_SCALE, type RubricCriterion } from "@/lib/instruments";
import {
  AI_SUPPORT_OPTIONS,
  SUPPORT_LEVEL_LABELS,
  getScaffoldingOption,
  type ScaffoldingType,
} from "@/lib/types";

interface RubricScore extends Record<RubricCriterion, number> {
  answerType: string;
  notes: string | null;
}

interface RubricAttempt {
  id: string;
  sessionCode: string;
  scenarioOrder: number;
  scenarioTitle: string;
  scenarioDescription: string;
  aiTypesUsed: ScaffoldingType[];
  finalAnswer: string;
  scores: RubricScore[];
}

function highestLevel(types: ScaffoldingType[]): number | null {
  const levels = types
    .map((type) => getScaffoldingOption(type)?.supportLevel)
    .filter((level): level is 0 | 1 | 2 | 3 => typeof level === "number");
  return levels.length > 0 ? Math.max(...levels) : null;
}

function UsageSummary({ attempts }: { attempts: RubricAttempt[] }) {
  const total = attempts.length;
  const countBy = (predicate: (a: RubricAttempt) => boolean) =>
    attempts.filter(predicate).length;
  const percent = (count: number) => (total ? Math.round((count / total) * 100) : 0);

  const levels = [1, 2, 3] as const;
  const noAi = countBy((a) => a.aiTypesUsed.length === 0);
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          Highest support level used by any member
        </h3>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          <li>
            No AI used: {noAi} ({percent(noAi)}%)
          </li>
          {levels.map((level) => {
            const count = countBy((a) => highestLevel(a.aiTypesUsed) === level);
            return (
              <li key={level}>
                Level {level} · {SUPPORT_LEVEL_LABELS[level]}: {count} ({percent(count)}%)
              </li>
            );
          })}
          <li>
            Used collaboration support:{" "}
            {countBy((a) =>
              a.aiTypesUsed.some((t) => getScaffoldingOption(t)?.category === "process")
            )}
          </li>
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          Scenarios where a member used each type
        </h3>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          {AI_SUPPORT_OPTIONS.map((option) => {
            const count = countBy((a) => a.aiTypesUsed.includes(option.type));
            return (
              <li key={option.type}>
                {option.label}: {count} ({percent(count)}%)
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ScoreForm({
  attemptId,
  existing,
  password,
  rater,
  onSaved,
}: {
  attemptId: string;
  existing: RubricScore | undefined;
  password: string;
  rater: string;
  onSaved: (score: RubricScore) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setStatus(null);
        const form = new FormData(event.currentTarget);
        const body: Record<string, unknown> = {
          attemptId,
          rater,
          notes: String(form.get("notes") ?? ""),
        };
        for (const criterion of RUBRIC_CRITERIA) {
          body[criterion.key] = Number(form.get(criterion.key));
        }
        const res = await fetch("/api/admin/rubric", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-password": password },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatus(data.error ?? "Save failed");
          return;
        }
        onSaved(data.score);
        setStatus("Saved");
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {RUBRIC_CRITERIA.map((criterion) => (
          <label key={criterion.key} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-slate-700">{criterion.label}</span>
            <select
              name={criterion.key}
              required
              defaultValue={existing?.[criterion.key] ?? ""}
              className="rounded-lg border border-slate-300 px-2 py-1"
            >
              <option value="" disabled>
                –
              </option>
              {RUBRIC_SCALE.map((point) => (
                <option key={point.value} value={point.value}>
                  {point.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <input
        name="notes"
        defaultValue={existing?.notes ?? ""}
        placeholder="Notes (optional)"
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!rater}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {existing ? "Update score" : "Save score"}
        </button>
        {status && <span className="text-xs text-slate-600">{status}</span>}
      </div>
    </form>
  );
}

export function RubricScoring({ password }: { password: string }) {
  const [rater, setRater] = useState("");
  const [blind, setBlind] = useState(true);
  const [attempts, setAttempts] = useState<RubricAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/rubric?rater=${encodeURIComponent(rater.trim())}`,
        { headers: { "x-admin-password": password } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load answers");
      setAttempts(data.attempts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load answers");
    }
  };

  const updateScore = (attemptId: string, score: RubricScore) => {
    setAttempts((prev) =>
      prev
        ? prev.map((attempt) =>
            attempt.id === attemptId
              ? {
                  ...attempt,
                  scores: [
                    ...attempt.scores.filter((s) => s.answerType !== score.answerType),
                    score,
                  ],
                }
              : attempt
          )
        : prev
    );
  };

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold text-slate-900">Rubric scoring and support usage</h2>
      <p className="mt-1 text-sm text-slate-600">
        Score each group&apos;s final answer on six criteria (1–4). Blind mode hides which
        AI support the members used, so the score isn&apos;t influenced by the condition.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm text-slate-700">Rater name or initials</span>
          <input
            value={rater}
            onChange={(e) => setRater(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
          Blind mode
        </label>
        <button
          type="button"
          onClick={load}
          disabled={!rater.trim()}
          className="rounded-lg border border-indigo-600 px-4 py-2 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          Load answers
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {attempts && (
        <>
          <p className="mt-4 text-sm text-slate-600">
            {attempts.length} submitted scenario answers.
          </p>
          <UsageSummary attempts={attempts} />

          <div className="mt-6 space-y-4">
            {attempts.map((attempt) => {
              return (
                <div key={attempt.id} className="rounded-xl border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">
                    {attempt.sessionCode} · Scenario {attempt.scenarioOrder}
                  </p>
                  <h3 className="font-medium text-slate-900">{attempt.scenarioTitle}</h3>
                  <p className="mt-1 text-sm text-slate-600">{attempt.scenarioDescription}</p>
                  {!blind && (
                    <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                      AI support used by members:{" "}
                      {attempt.aiTypesUsed.length > 0
                        ? attempt.aiTypesUsed
                            .map((type) => getScaffoldingOption(type)?.label ?? type)
                            .join(", ")
                        : "none"}
                    </div>
                  )}
                  <div className="mt-3 rounded-lg border border-slate-100 p-3">
                    <p className="text-sm font-semibold text-slate-900">Final group answer</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                      {attempt.finalAnswer || "(empty)"}
                    </p>
                    <ScoreForm
                      attemptId={attempt.id}
                      existing={attempt.scores.find((s) => s.answerType === "final")}
                      password={password}
                      rater={rater.trim()}
                      onSaved={(score) => updateScore(attempt.id, score)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
