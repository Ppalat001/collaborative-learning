"use client";

import { useState } from "react";
import { participantHeaders } from "@/lib/client/participant";

export interface V2LobbyInfo {
  condition: string;
  conditionDescription: string;
  minGroupSize: number;
  maxGroupSize: number;
  started: boolean;
  readiness: {
    canStart: boolean;
    started: boolean;
    blockers: string[];
    activeMemberCount: number;
    members: {
      id: string;
      name: string;
      consented: boolean;
      withdrawn: boolean;
      droppedOut: boolean;
      preTestCompleted: boolean;
      inFrozenRoster: boolean;
    }[];
  };
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
      }`}
    >
      {ok ? "✓ " : ""}
      {label}
    </span>
  );
}

/** V2 member readiness, the server-checked start gate and withdrawal. */
export function V2LobbyPanel({
  code,
  info,
  participantId,
  onStarted,
  onChanged,
}: {
  code: string;
  info: V2LobbyInfo;
  participantId: string | null;
  onStarted: () => void;
  onChanged: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const me = info.readiness.members.find((m) => m.id === participantId);
  const { readiness } = info;

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${code}/start`, {
        method: "POST",
        headers: participantHeaders(),
        body: JSON.stringify({ participantId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError([data.error ?? "The group cannot start yet", ...(data.blockers ?? [])].join(" "));
        onChanged();
        return;
      }
      onStarted();
    } finally {
      setStarting(false);
    }
  };

  const withdraw = async () => {
    const res = await fetch(`/api/sessions/${code}/consent`, {
      method: "POST",
      headers: participantHeaders(),
      body: JSON.stringify({ participantId, action: "withdraw" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Could not record the withdrawal");
    setConfirmWithdraw(false);
    onChanged();
  };

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold text-slate-900">Group readiness</h2>
      <p className="mt-1 text-sm text-slate-600">{info.conditionDescription}</p>
      <p className="mt-1 text-xs text-slate-500">
        Groups need {info.minGroupSize === info.maxGroupSize ? info.minGroupSize : `${info.minGroupSize}–${info.maxGroupSize}`}{" "}
        members. Everyone gives their own consent and completes the pre-test before the group can begin. Once
        the group begins, nobody new can join.
      </p>
      <ul className="mt-4 space-y-2">
        {readiness.members.map((member) => (
          <li
            key={member.id}
            className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 ${
              member.id === participantId ? "bg-indigo-50" : "bg-slate-50"
            }`}
          >
            <span className="font-medium text-slate-900">
              {member.name}
              {member.id === participantId && " (you)"}
            </span>
            {member.withdrawn ? (
              <span className="text-xs text-slate-500">withdrew</span>
            ) : (
              <>
                <Status ok={member.consented} label="consent" />
                <Status ok={member.preTestCompleted} label="pre-test" />
                {member.droppedOut && <span className="text-xs text-slate-500">left the group</span>}
              </>
            )}
          </li>
        ))}
      </ul>
      {!readiness.started && readiness.blockers.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber-800">
          {readiness.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <button
        type="button"
        onClick={readiness.started ? onStarted : start}
        disabled={starting || !me || me.withdrawn || !me.consented || (!readiness.started && !readiness.canStart)}
        className="mt-5 rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {readiness.started ? "Continue scenarios" : starting ? "Starting..." : "Begin scenarios"}
      </button>
      {me?.consented && !me.withdrawn && (
        <div className="mt-6 border-t border-slate-100 pt-4 text-sm">
          {confirmWithdraw ? (
            <div className="space-y-2">
              <p className="text-slate-700">
                Withdraw your consent? Nothing more will be recorded for you. This is recorded, not deleted; how
                earlier data is handled follows the information sheet.
              </p>
              <button type="button" onClick={withdraw} className="rounded-lg bg-red-600 px-3 py-1.5 text-white">
                Yes, withdraw my consent
              </button>{" "}
              <button
                type="button"
                onClick={() => setConfirmWithdraw(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmWithdraw(true)} className="text-slate-500 underline">
              Withdraw my consent
            </button>
          )}
        </div>
      )}
    </section>
  );
}
