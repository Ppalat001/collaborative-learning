"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function HomePage() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createSession = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create session");
      const joinRes = await fetch(`/api/sessions/${data.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "Facilitator" }),
      });
      const joinData = await joinRes.json();
      if (!joinRes.ok) throw new Error(joinData.error ?? "Failed to join session");
      localStorage.setItem("participantName", "Facilitator");
      localStorage.setItem("participantId", joinData.participant.id);
      router.push(`/session/${data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  };

  const joinSession = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const code = joinCode.trim().toUpperCase();
      const res = await fetch(`/api/sessions/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to join");
      localStorage.setItem("participantName", displayName);
      localStorage.setItem("participantId", data.participant.id);
      router.push(`/session/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join");
    } finally {
      setLoading(false);
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
            For researchers or facilitators starting a new group (2–4 students).
          </p>
          <button
            type="button"
            onClick={createSession}
            disabled={loading}
            className="mt-5 rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create session"}
          </button>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Join a group session</h2>
          <form className="mt-4 space-y-4" onSubmit={joinSession}>
            <label className="block space-y-1">
              <span className="text-sm text-slate-700">Session code</span>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="GROUP-ABCD"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm text-slate-700">Your first name or nickname</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alex"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg border border-indigo-600 px-5 py-2.5 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              Join session
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
