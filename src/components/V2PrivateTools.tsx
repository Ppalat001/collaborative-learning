"use client";

import { useState } from "react";

const INITIAL_IDEA_MAX = 1000;
const SHARE_MAX = 600;

/** Private pre-AI idea (instrument flag). Saved once; never copied into the group answer. */
export function InitialIdeaForm({
  mode,
  submitted,
  text,
  busy,
  onSubmit,
}: {
  mode: "optional" | "required";
  submitted: boolean;
  text: string | null;
  busy: boolean;
  onSubmit: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  if (submitted) {
    return (
      <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Your first idea (private)</p>
        <p className="mt-1 whitespace-pre-line">{text}</p>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-900">
        Your own first idea {mode === "required" ? "(needed before using AI support)" : "(optional)"}
      </p>
      <p className="text-xs text-slate-500">
        Only you and the researcher see this. Write what you think before using any AI support.
      </p>
      <textarea
        value={draft}
        maxLength={INITIAL_IDEA_MAX}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="button"
        disabled={!draft.trim() || busy}
        onClick={() => onSubmit(draft)}
        className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Save my idea
      </button>
    </div>
  );
}

export interface ShareSource {
  sourceType: "individual_scaffold" | "intervention";
  sourceId: string;
  label: string;
  text: string;
}

/**
 * Explicit sharing of a private AI idea: choose, edit the preview, confirm.
 * The group sees only what the member confirmed.
 */
export function ShareIdeaControl({
  sources,
  initialSource,
  busy,
  onShare,
  onClose,
}: {
  sources: ShareSource[];
  initialSource?: ShareSource | null;
  busy: boolean;
  onShare: (source: ShareSource, text: string) => Promise<boolean>;
  onClose?: () => void;
}) {
  const [selectedId, setSelectedId] = useState(initialSource?.sourceId ?? "");
  const selected = sources.find((s) => s.sourceId === selectedId) ?? null;
  const [text, setText] = useState(initialSource?.text.slice(0, SHARE_MAX) ?? "");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  if (sources.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-slate-900">Share a short idea with your group</p>
      <p className="text-xs text-slate-500">
        Private AI responses stay private unless you share them. Edit the text so it shows only what you want the
        group to see (up to {SHARE_MAX} characters). Full expert answers cannot be shared this way.
      </p>
      <select
        value={selectedId}
        onChange={(e) => {
          const source = sources.find((s) => s.sourceId === e.target.value);
          setSelectedId(e.target.value);
          setText(source?.text.slice(0, SHARE_MAX) ?? "");
          setConfirming(false);
          setDone(false);
        }}
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="">Choose one of your AI responses...</option>
        {sources.map((source) => (
          <option key={source.sourceId} value={source.sourceId}>
            {source.label}
          </option>
        ))}
      </select>
      {selected && (
        <>
          <textarea
            value={text}
            maxLength={SHARE_MAX}
            onChange={(e) => {
              setText(e.target.value);
              setConfirming(false);
            }}
            rows={4}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {!confirming ? (
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() => setConfirming(true)}
              className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
            >
              Preview
            </button>
          ) : (
            <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs text-slate-500">
                Your group will see exactly this in the Step 1 chat, marked &quot;Shared by you · AI-assisted
                excerpt&quot;:
              </p>
              <blockquote className="mt-1 border-l-4 border-slate-300 pl-3 whitespace-pre-line text-slate-800">
                {text.trim()}
              </blockquote>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (await onShare(selected, text)) {
                    setDone(true);
                    setConfirming(false);
                    onClose?.();
                  }
                }}
                className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Confirm and share
              </button>{" "}
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
              >
                Edit
              </button>
            </div>
          )}
          {done && <p className="mt-2 text-xs text-emerald-700">Shared with your group in the Step 1 chat.</p>}
        </>
      )}
    </div>
  );
}
