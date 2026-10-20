"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DISPLAY_NAME_MAX_LENGTH, normalizeDisplayName } from "@/lib/instruments";

async function joinAs(code: string, name: string) {
  const res = await fetch(`/api/sessions/${code}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to join session");
  localStorage.setItem("participantName", data.participant.displayName);
  localStorage.setItem("participantId", data.participant.id);
}

function NameField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block space-y-1">
      <span className="text-sm text-slate-700">
        Your first name or nickname <span className="text-red-600">*</span>
      </span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Alex"
        required
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        autoComplete="given-name"
        className="w-full rounded-lg border border-slate-300 px-3 py-2"
      />
      <span className="block text-xs text-slate-500">
        Required. Your group sees this name; the research data uses an anonymous code.
      </span>
    </label>
  );
}

export function HomePage() {
  const router = useRouter();
  const [creatorName, setCreatorName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createSession = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = normalizeDisplayName(creatorName);
    if (!name) {
      setError("Please enter your name to create a session.");
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create session");
      await joinAs(data.code, name);
      router.push(`/session/${data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setBusy(null);
    }
  };

  const joinSession = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    const name = normalizeDisplayName(displayName);
    if (!code || !name) {
      setError("Please enter both the group ID and your name to join.");
      return;
    }
    setBusy("join");
    setError(null);
    try {
      await joinAs(code, name);
      router.push(`/session/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col px-4 py-10">
      <header className="mb-10">
        <p className="text-sm font-medium uppercase tracking-wide text-indigo-600">
          Dissertation Research System
        </p>
        <h1 className="mt-2 text-4xl font-semibold text-slate-900">
          Collaborative AI Learning
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-slate-600">
          Small groups work through structured scenarios, choose their own AI
          scaffolding, and submit a joint answer. The AI supports collaboration —
          it does not autopilot the task.
        </p>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Create a group session</h2>
          <p className="mt-2 text-sm text-slate-600">
            For the first member of a new group (2–4 students). You join the group with
            your name and get a group ID to share with the others.
          </p>
          <form className="mt-4 space-y-4" onSubmit={createSession}>
            <NameField id="creator-name" value={creatorName} onChange={setCreatorName} />
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy === "create" ? "Creating..." : "Create session"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Join a group session</h2>
          <form className="mt-4 space-y-4" onSubmit={joinSession}>
            <label htmlFor="join-code" className="block space-y-1">
              <span className="text-sm text-slate-700">
                Group ID <span className="text-red-600">*</span>
              </span>
              <input
                id="join-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="GROUP-ABCD"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
              />
            </label>
            <NameField id="join-name" value={displayName} onChange={setDisplayName} />
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded-lg border border-indigo-600 px-5 py-2.5 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              {busy === "join" ? "Joining..." : "Join session"}
            </button>
          </form>
        </section>
      </div>

      <footer className="mt-10 text-sm text-slate-500">
        <Link href="/admin" className="text-indigo-600 hover:underline">
          Researcher admin
        </Link>
      </footer>
    </div>
  );
}
