"use client";

import { useState } from "react";
import type { FeedbackAction, InterventionView } from "@/lib/intervention/types";

/** View/accept, Not now, Dismiss and "Why this suggestion?" for an AI offer. */
export function InterventionFeedbackControls({
  view,
  acceptLabel,
  busy,
  onRespond,
}: {
  view: InterventionView;
  acceptLabel: string;
  busy: string | null;
  onRespond: (id: string, action: FeedbackAction) => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const pending = busy?.startsWith(`${view.id}:`) ?? false;
  const actionable = view.status === "suggested" || view.status === "deferred";

  return (
    <div className="mt-3">
      {actionable && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => onRespond(view.id, "accepted")}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {pending && busy === `${view.id}:accepted` ? "Opening..." : acceptLabel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onRespond(view.id, "deferred")}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onRespond(view.id, "dismissed")}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          if (!showWhy) onRespond(view.id, "why_viewed");
          setShowWhy((value) => !value);
        }}
        className="mt-2 text-xs text-violet-700 underline"
      >
        {showWhy ? "Hide explanation" : "Why this suggestion?"}
      </button>
      {showWhy && <p className="mt-1 rounded-lg bg-violet-50 px-3 py-2 text-xs text-slate-700">{view.reasonExplanation}</p>}
    </div>
  );
}
