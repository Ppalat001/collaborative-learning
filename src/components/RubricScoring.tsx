"use client";

import { useState } from "react";
import { RUBRIC_CRITERIA, RUBRIC_SCALE, type RubricCriterion } from "@/lib/instruments";

interface RubricScore extends Record<RubricCriterion, number> {
  answerType: string;
  notes: string | null;
}

interface RubricAttempt {
  id: string;
  scenarioOrder: number;
  scenarioTitle: string;
  scenarioDescription: string;
  finalAnswer: string;
  scores: RubricScore[];
}

interface RubricGroup {
  sessionCode: string;
  members: { id: string; name: string }[];
  attempts: RubricAttempt[];
}

function totalOf(score: RubricScore): number {
  return RUBRIC_CRITERIA.reduce((sum, criterion) => sum + score[criterion.key], 0);
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
        setStatus(existing ? "Updated" : "Saved");
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
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
        >
          {existing ? "Update score" : "Save score"}
        </button>
        {existing && (
          <span className="text-xs text-slate-600">
            Current total {totalOf(existing)}/24
          </span>
        )}
        {status && <span className="text-xs text-emerald-700">{status}</span>}
      </div>
    </form>
  );
}

export function RubricScoring({
  password,
  groupCodes,
}: {
  password: string;
  groupCodes: string[];
}) {
  const [code, setCode] = useState("");
  const [rater, setRater] = useState("");
  const [group, setGroup] = useState<RubricGroup | null>(null);
  const [scoringAs, setScoringAs] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ session: code.trim(), rater: rater.trim() });
      const res = await fetch(`/api/admin/rubric?${params}`, {
        headers: { "x-admin-password": password },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load answers");
      setGroup(data);
      setScoringAs(rater.trim());
    } catch (err) {
      setGroup(null);
      setError(err instanceof Error ? err.message : "Failed to load answers");
    }
  };

  const updateScore = (attemptId: string, score: RubricScore) => {
    setGroup((prev) =>
      prev
        ? {
            ...prev,
            attempts: prev.attempts.map((attempt) =>
              attempt.id === attemptId
                ? {
                    ...attempt,
                    scores: [
                      ...attempt.scores.filter((s) => s.answerType !== score.answerType),
                      score,
                    ],
                  }
                : attempt
            ),
          }
        : prev
    );
  };

  const scored = group?.attempts.filter((a) => a.scores.some((s) => s.answerType === "final"))
    .length;

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold text-slate-900">Rubric scoring</h2>
      <p className="mt-1 text-sm text-slate-600">
        Enter a group ID to score that group&apos;s final answers on six criteria (1–4). Load
        the same group with the same rater name to change a score. The AI help the members used
        is not shown here, so it can&apos;t influence the score.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm text-slate-700">Group ID</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="GROUP-ABCD"
            list="rubric-group-codes"
            className="rounded-lg border border-slate-300 px-3 py-2 uppercase"
          />
          <datalist id="rubric-group-codes">
            {groupCodes.map((groupCode) => (
              <option key={groupCode} value={groupCode} />
            ))}
          </datalist>
        </label>
        <label className="space-y-1">
          <span className="block text-sm text-slate-700">Rater name or initials</span>
          <input
            value={rater}
            onChange={(e) => setRater(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={!password || !code.trim() || !rater.trim()}
          className="rounded-lg border border-indigo-600 px-4 py-2 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          Load group
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {group && (
        <>
          <p className="mt-4 text-sm text-slate-600">
            {group.sessionCode} · {group.members.map((m) => m.name).join(", ")} ·{" "}
            {group.attempts.length} submitted answers · {scored} scored by {scoringAs}
          </p>

          {group.attempts.length === 0 && (
            <p className="mt-4 text-sm text-slate-500">This group has no submitted answers yet.</p>
          )}

          <div className="mt-6 space-y-4">
            {group.attempts.map((attempt) => (
              <div key={attempt.id} className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500">
                  {group.sessionCode} · Scenario {attempt.scenarioOrder}
                </p>
                <h3 className="font-medium text-slate-900">{attempt.scenarioTitle}</h3>
                <p className="mt-1 text-sm text-slate-600">{attempt.scenarioDescription}</p>
                <div className="mt-3 rounded-lg border border-slate-100 p-3">
                  <p className="text-sm font-semibold text-slate-900">Final group answer</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                    {attempt.finalAnswer || "(empty)"}
                  </p>
                  <ScoreForm
                    key={`${attempt.id}:${scoringAs}`}
                    attemptId={attempt.id}
                    existing={attempt.scores.find((s) => s.answerType === "final")}
                    password={password}
                    rater={scoringAs}
                    onSaved={(score) => updateScore(attempt.id, score)}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
