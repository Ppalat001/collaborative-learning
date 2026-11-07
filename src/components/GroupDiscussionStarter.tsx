"use client";

import type { ChosenRole } from "@/hooks/useInterventions";
import type { CheckpointView } from "@/lib/intervention/types";
import type { GroupMember } from "@/lib/types";

interface RoleCard {
  id: string;
  label: string;
  description: string;
}

/**
 * Non-AI collaboration structure shown identically in every V2 condition: the
 * neutral opening prompt, optional human role cards and checkpoint questions.
 */
export function GroupDiscussionStarter({
  openingPrompt,
  roles,
  chosenRoles,
  checkpointKinds,
  checkpoints,
  members,
  participantId,
  locked,
  busy,
  onChooseRole,
  onRaiseCheckpoint,
}: {
  openingPrompt: { starterName: string | null; steps: string[] } | null;
  roles: { cards: readonly RoleCard[]; suggested: Record<string, string> } | null;
  chosenRoles: ChosenRole[];
  checkpointKinds: { kind: string; text: string }[] | null;
  checkpoints: CheckpointView[];
  members: GroupMember[];
  participantId: string | null;
  locked: boolean;
  busy: string | null;
  onChooseRole: (role: string) => void;
  onRaiseCheckpoint: (kind: string) => void;
}) {
  if (!openingPrompt && !roles && !checkpointKinds) return null;
  const roleLabel = (id: string | undefined) => roles?.cards.find((c) => c.id === id)?.label ?? id;
  const myRole = chosenRoles.find((r) => r.participantId === participantId)?.role;
  const suggestedForMe = participantId ? roles?.suggested[participantId] : undefined;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">How to get started</h2>
      {openingPrompt && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-700">
          {openingPrompt.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      {roles && (
        <div className="mt-5">
          <p className="text-sm font-medium text-slate-800">Optional roles (you can pick any role, or none)</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {roles.cards.map((card) => {
              const holders = chosenRoles
                .filter((r) => r.role === card.id)
                .map((r) => members.find((m) => m.id === r.participantId)?.name)
                .filter(Boolean);
              return (
                <button
                  key={card.id}
                  type="button"
                  disabled={locked || busy === "role"}
                  onClick={() => onChooseRole(card.id)}
                  className={`rounded-xl border p-3 text-left text-sm ${
                    myRole === card.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                  }`}
                >
                  <span className="font-medium text-slate-900">{card.label}</span>
                  {suggestedForMe === card.id && myRole !== card.id && (
                    <span className="ml-2 text-xs text-indigo-700">suggested for you this time</span>
                  )}
                  <span className="mt-1 block text-xs text-slate-600">{card.description}</span>
                  {holders.length > 0 && <span className="mt-1 block text-xs text-slate-500">Taken by {holders.join(", ")}</span>}
                </button>
              );
            })}
          </div>
          {myRole && <p className="mt-2 text-xs text-slate-500">Your role: {roleLabel(myRole)}</p>}
        </div>
      )}

      {checkpointKinds && (
        <div className="mt-5">
          <p className="text-sm font-medium text-slate-800">Group checkpoints</p>
          <p className="text-xs text-slate-500">Raise a question for the whole group to discuss (no AI involved).</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {checkpointKinds.map(({ kind, text }) => (
              <button
                key={kind}
                type="button"
                disabled={locked || busy === "checkpoint"}
                onClick={() => onRaiseCheckpoint(kind)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {text}
              </button>
            ))}
          </div>
          {checkpoints.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              {checkpoints.map((checkpoint) => (
                <li key={checkpoint.id} className="rounded-lg bg-amber-50 px-3 py-2">
                  <strong>{checkpoint.raisedByName}</strong> asked the group: {checkpoint.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
