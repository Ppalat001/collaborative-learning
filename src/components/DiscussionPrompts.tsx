"use client";

import type { CheckpointView } from "@/lib/intervention/types";

/**
 * Non-AI question cards shown inside Step 1 (Group discussion). A member picks a
 * question and it is posted for the whole group to discuss. Nothing is generated.
 */
export function DiscussionPrompts({
  kinds,
  raised,
  locked,
  busy,
  onRaise,
}: {
  kinds: { kind: string; text: string }[] | null;
  raised: CheckpointView[];
  locked: boolean;
  busy: string | null;
  onRaise: (kind: string) => void;
}) {
  if (!kinds || kinds.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-900">Discussion prompts</h3>
      <p className="mt-0.5 text-xs text-slate-600">
        Not sure what to discuss next? Pick a question to put to your group. Everyone sees it. No AI is involved.
      </p>

      {raised.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Prompts raised in this scenario">
          {raised.map((prompt) => (
            <li key={prompt.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-800">
              <span className="font-semibold">{prompt.raisedByName}</span> asked the group:{" "}
              <span className="italic">{prompt.text}</span>
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <div className="mt-3 flex flex-wrap gap-2">
          {kinds.map(({ kind, text }) => (
            <button
              key={kind}
              type="button"
              disabled={busy === "checkpoint"}
              onClick={() => onRaise(kind)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-sm text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
