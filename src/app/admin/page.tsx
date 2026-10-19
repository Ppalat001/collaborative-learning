"use client";

import Link from "next/link";
import { useState } from "react";
import { RubricScoring } from "@/components/RubricScoring";

const EXPORTS = [
  {
    type: "scenarios",
    label: "Group answers per scenario",
    description:
      "Final answer, who wrote which share, AI help each student used, how much of the answer was copied from AI, chat before/after AI, time, rubric total",
  },
  {
    type: "messages",
    label: "Discussion chat log",
    description: "Every chat message with student name, time and whether it was before or after AI",
  },
  {
    type: "ai_support",
    label: "Individual AI support",
    description:
      "Every AI help each student selected: type, level, how often shown/hidden and the AI reply",
  },
  {
    type: "contributions",
    label: "Individual contributions",
    description:
      "Per student per scenario: chat messages and words, characters typed, share of the final answer",
  },
  {
    type: "ratings",
    label: "Individual scenario ratings",
    description: "Per student per scenario: the 1-5 ratings, amount of AI help and comment",
  },
  {
    type: "assessments",
    label: "Pre/post-test comparison",
    description:
      "One row per student: pre and post scores, each concept and the written answers side by side",
  },
  {
    type: "reflections",
    label: "End questionnaire",
    description: "One row per student with every answer from the questionnaire after the post-test",
  },
  {
    type: "rubric",
    label: "Rubric scores",
    description: "Your scores for each final group answer (6 criteria, 1-4 each, total 6-24)",
  },
] as const;

interface GroupSummary {
  code: string;
  createdAt: string;
  completedAt: string | null;
  members: string[];
  scenariosFinished: number;
  totalScenarios: number;
}

async function adminFetch(url: string, password: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "x-admin-password": password,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return res;
}

async function downloadExport(type: string, code: string, password: string) {
  const res = await adminFetch(
    `/api/admin/export?type=${type}&session=${encodeURIComponent(code)}`,
    password
  );
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${code}-${type}.csv`;
  link.click();
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [selected, setSelected] = useState("");

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const fetchGroups = async (keep: string) => {
    const res = await adminFetch("/api/admin/sessions", password);
    const data: { sessions: GroupSummary[] } = await res.json();
    setGroups(data.sessions);
    setSelected(
      data.sessions.some((g) => g.code === keep) ? keep : data.sessions[0]?.code ?? ""
    );
  };

  const loadGroups = () => run(() => fetchGroups(selected));

  const deleteGroup = () =>
    run(async () => {
      const confirm = window.prompt(
        `This permanently deletes group ${selected} and everything recorded for it. Type ${selected} to confirm.`
      );
      if (confirm === null) return;
      await adminFetch(
        `/api/admin/sessions?session=${encodeURIComponent(selected)}`,
        password,
        { method: "DELETE", body: JSON.stringify({ confirm }) }
      );
      await fetchGroups("");
      setNotice(`Group ${selected} deleted.`);
    });

  const deleteAll = () =>
    run(async () => {
      const confirm = window.prompt(
        'This permanently deletes EVERY group and all study data. Type "DELETE ALL" to confirm.'
      );
      if (confirm === null) return;
      const res = await adminFetch("/api/admin/sessions?all=1", password, {
        method: "DELETE",
        body: JSON.stringify({ confirm }),
      });
      const data = await res.json();
      setNotice(`Deleted ${data.deleted} group(s). The database is now empty.`);
      setSelected("");
      setGroups([]);
    });

  const selectedGroup = groups?.find((g) => g.code === selected);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        Back home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold text-slate-900">Researcher admin</h1>
      <p className="mt-2 text-slate-600">
        Export one group&apos;s data as CSV, score group answers with the rubric, and clean up
        test data.
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
          {notice}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-full max-w-sm space-y-1">
            <span className="text-sm text-slate-700">Admin password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={loadGroups}
            disabled={!password}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {groups ? "Refresh groups" : "Load groups"}
          </button>
        </div>

        {groups && (
          <label className="mt-5 block max-w-xl space-y-1">
            <span className="text-sm text-slate-700">Group</span>
            {groups.length === 0 ? (
              <p className="text-sm text-slate-500">No groups in the database.</p>
            ) : (
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {groups.map((group) => (
                  <option key={group.code} value={group.code}>
                    {group.code} · {group.members.join(", ") || "no members"} ·{" "}
                    {group.scenariosFinished}/{group.totalScenarios} scenarios ·{" "}
                    {group.createdAt.slice(0, 10)}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}

        <h2 className="mt-6 font-semibold text-slate-900">
          CSV exports{selectedGroup ? ` for ${selectedGroup.code}` : ""}
        </h2>
        {!selectedGroup && (
          <p className="mt-1 text-sm text-slate-500">
            Enter the password and load the groups, then choose a group to download its data.
          </p>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {EXPORTS.map((item) => (
            <button
              key={item.type}
              type="button"
              disabled={!selectedGroup}
              onClick={() => run(() => downloadExport(item.type, selected, password))}
              className="rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200"
            >
              <div className="font-medium text-indigo-700">{item.label}</div>
              <div className="mt-1 text-xs text-slate-600">{item.description}</div>
            </button>
          ))}
        </div>

        {groups && (
          <div className="mt-8 rounded-xl border border-red-200 bg-red-50/50 p-4">
            <h2 className="font-semibold text-red-800">Clean up data</h2>
            <p className="mt-1 text-sm text-red-700">
              Deleting cannot be undone. Download anything you need first.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={deleteGroup}
                disabled={!selectedGroup}
                className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Delete group {selectedGroup?.code ?? ""}
              </button>
              <button
                type="button"
                onClick={deleteAll}
                disabled={groups.length === 0}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                Delete all groups
              </button>
            </div>
          </div>
        )}
      </div>

      <RubricScoring password={password} />
    </div>
  );
}
