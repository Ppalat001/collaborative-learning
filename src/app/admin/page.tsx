"use client";

import Link from "next/link";
import { useState } from "react";
import { RubricScoring } from "@/components/RubricScoring";

const EXPORTS = [
  {
    type: "scenarios",
    label: "Group answers per scenario",
    description:
      "Chat before and after AI, help reason, support level, final answer, overlap with AI text, participation balance, rubric mean",
  },
  {
    type: "ratings",
    label: "Individual scenario ratings",
    description: "One row per student per scenario",
  },
  {
    type: "contributions",
    label: "Individual contributions",
    description: "Chat messages and characters each student wrote, per scenario",
  },
  {
    type: "messages",
    label: "Discussion chat log",
    description: "Every chat message, with anonymous ID, time and whether it was before AI",
  },
  {
    type: "edits",
    label: "Raw edit log",
    description: "Every batch of typing, with anonymous ID and timestamp",
  },
  {
    type: "reflections",
    label: "End-of-study open answers",
    description: "One row per student",
  },
  {
    type: "rubric",
    label: "Rubric scores",
    description: "Researcher scores for final answers",
  },
  {
    type: "assessments",
    label: "Pre/post-test scores",
    description: "One row per student per test",
  },
] as const;

async function downloadExport(type: string, password: string) {
  const res = await fetch(`/api/admin/export?type=${type}`, {
    headers: { "x-admin-password": password },
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? "Export failed");
  }
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${type}-export-${Date.now()}.csv`;
  link.click();
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const download = (type: string) => {
    setError(null);
    downloadExport(type, password).catch((err) =>
      setError(err instanceof Error ? err.message : "Export failed")
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/" className="text-sm text-indigo-600 hover:underline">
        Back home
      </Link>
      <h1 className="mt-4 text-3xl font-semibold text-slate-900">Researcher admin</h1>
      <p className="mt-2 text-slate-600">
        Export session data as CSV and score group answers with the rubric.
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <label className="block max-w-sm space-y-1">
          <span className="text-sm text-slate-700">Admin password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <h2 className="mt-6 font-semibold text-slate-900">CSV exports</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {EXPORTS.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => download(item.type)}
              className="rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-400"
            >
              <div className="font-medium text-indigo-700">{item.label}</div>
              <div className="mt-1 text-xs text-slate-600">{item.description}</div>
            </button>
          ))}
        </div>
      </div>

      <RubricScoring password={password} />
    </div>
  );
}
