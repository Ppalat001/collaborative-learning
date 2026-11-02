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

interface MemberSupport {
  participantId: string;
  requests: { type: ScaffoldingType; selected: boolean }[];
}

interface RubricAttempt {
  id: string;
  scenarioOrder: number;
  scenarioTitle: string;
  scenarioDescription: string;
  support: MemberSupport[];
  finalAnswer: string;
  scores: RubricScore[];
}

interface RubricGroup {
  sessionCode: string;
  members: { id: string; name: string }[];
  attempts: RubricAttempt[];
}

/** Highest help one student requested in a scenario, as shown in the tables. */
type UsageBucket = "none" | 1 | 2 | 3 | "process";

const BUCKETS: { key: UsageBucket; label: string }[] = [
  { key: "none", label: "No AI" },
  { key: 1, label: `Level 1 · ${SUPPORT_LEVEL_LABELS[1]}` },
  { key: 2, label: `Level 2 · ${SUPPORT_LEVEL_LABELS[2]}` },
  { key: 3, label: `Level 3 · ${SUPPORT_LEVEL_LABELS[3]}` },
  { key: "process", label: "Collaboration support only" },
];

function bucketOf(support: MemberSupport): UsageBucket {
  if (support.requests.length === 0) return "none";
  const levels = support.requests
    .map((request) => getScaffoldingOption(request.type)?.supportLevel)
    .filter((level): level is 1 | 2 | 3 => typeof level === "number" && level > 0);
  return levels.length > 0 ? (Math.max(...levels) as 1 | 2 | 3) : "process";
}

function share(count: number, total: number): string {
  return `${count} (${total ? Math.round((count / total) * 100) : 0}%)`;
}

function totalOf(score: RubricScore): number {
  return RUBRIC_CRITERIA.reduce((sum, criterion) => sum + score[criterion.key], 0);
}

function GroupUsage({ group }: { group: RubricGroup }) {
  const scenarios = group.attempts.length;
  const supportOf = (memberId: string) =>
    group.attempts.map(
      (attempt) =>
        attempt.support.find((s) => s.participantId === memberId) ?? {
          participantId: memberId,
          requests: [],
        }
    );
  const all = group.attempts.flatMap((attempt) => attempt.support);
  const cell = "border-b border-slate-100 px-2 py-1.5";

  return (
    <div className="mt-5 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          Highest help each student used, per scenario
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Each cell counts that student&apos;s scenarios out of {scenarios}. &quot;All
          students&quot; counts every student in every scenario ({all.length}), so two
          students who both chose Level 3 count twice.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className={cell}>Student</th>
                {BUCKETS.map((bucket) => (
                  <th key={String(bucket.key)} className={cell}>
                    {bucket.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {group.members.map((member) => {
                const rows = supportOf(member.id);
                return (
                  <tr key={member.id}>
                    <td className={`${cell} font-medium`}>{member.name}</td>
                    {BUCKETS.map((bucket) => (
                      <td key={String(bucket.key)} className={cell}>
                        {share(rows.filter((s) => bucketOf(s) === bucket.key).length, scenarios)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr className="font-medium">
                <td className={cell}>All students</td>
                {BUCKETS.map((bucket) => (
                  <td key={String(bucket.key)} className={cell}>
                    {share(all.filter((s) => bucketOf(s) === bucket.key).length, all.length)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          Scenarios in which each student requested each type
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          A student can request several types in one scenario, so a row can add up to more
          than 100%. Hidden replies still count as requested.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className={cell}>Student</th>
                {AI_SUPPORT_OPTIONS.map((option) => (
                  <th key={option.type} className={cell}>
                    {option.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {group.members.map((member) => {
                const rows = supportOf(member.id);
                return (
                  <tr key={member.id}>
                    <td className={`${cell} font-medium`}>{member.name}</td>
                    {AI_SUPPORT_OPTIONS.map((option) => (
                      <td key={option.type} className={cell}>
                        {share(
                          rows.filter((s) => s.requests.some((r) => r.type === option.type))
                            .length,
                          scenarios
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ScenarioUsage({ attempt, group }: { attempt: RubricAttempt; group: RubricGroup }) {
  const members = group.members.length;
  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
      <p className="font-semibold text-slate-900">AI help in this scenario</p>
      <ul className="mt-1 space-y-0.5">
        {group.members.map((member) => {
          const support = attempt.support.find((s) => s.participantId === member.id);
          const requests = support?.requests ?? [];
          return (
            <li key={member.id}>
              <span className="font-medium">{member.name}:</span>{" "}
              {requests.length === 0
                ? "no AI"
                : requests
                    .map(
                      (r) =>
                        `${getScaffoldingOption(r.type)?.label ?? r.type}${r.selected ? "" : " (hidden)"}`
                    )
                    .join(", ")}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-600">
        Highest level per student:{" "}
        {BUCKETS.map((bucket) => ({
          label: bucket.label,
          count: attempt.support.filter((s) => bucketOf(s) === bucket.key).length,
        }))
          .filter((item) => item.count > 0)
          .map((item) => `${item.label} ${item.count} of ${members} (${Math.round((item.count / members) * 100)}%)`)
          .join(" · ")}
      </p>
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
  const [blind, setBlind] = useState(true);
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
      <h2 className="font-semibold text-slate-900">Rubric scoring and support usage</h2>
      <p className="mt-1 text-sm text-slate-600">
        Enter a group ID to score that group&apos;s final answers on six criteria (1–4). Load
        the same group with the same rater name to change a score. Blind mode hides which AI
        help the members used, so the score isn&apos;t influenced by it.
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
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
          Blind mode
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

          {blind ? (
            <p className="mt-2 text-xs text-slate-500">
              Untick Blind mode to see how much AI help each student used.
            </p>
          ) : (
            <GroupUsage group={group} />
          )}

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
                {!blind && <ScenarioUsage attempt={attempt} group={group} />}
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
