"use client";

import { useEffect, useState } from "react";
import type { InterventionView, LearningAwareMemberState, ProgressFeedbackResponse } from "@/lib/intervention/types";

const OPTIONS: { response: ProgressFeedbackResponse; label: string }[] = [
  { response: "yes", label: "Yes" },
  { response: "partly", label: "Partly" },
  { response: "no", label: "No" },
  { response: "not_needed", label: "I didn't need it" },
  { response: "skip", label: "Skip" },
];

/**
 * Voluntary one-click check after delivered proactive support (policy-v2-3+).
 * Shown a short while after delivery, answered once, and only to this member.
 * It is not a study question; not answering is recorded as nothing at all.
 */
export function ProgressFeedbackPrompt({
  item,
  learningAware,
  busy,
  onAnswer,
}: {
  item: InterventionView;
  learningAware: LearningAwareMemberState | null;
  busy: string | null;
  onAnswer: (id: string, response: ProgressFeedbackResponse) => void;
}) {
  const dueAt =
    item.deliveredAt && learningAware ? Date.parse(item.deliveredAt) + learningAware.feedbackDelaySeconds * 1000 : null;
  const [now, setNow] = useState(() => Date.now());
  const due = dueAt !== null && now >= dueAt;

  useEffect(() => {
    if (dueAt === null || due) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, dueAt - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [dueAt, due]);

  if (!learningAware?.feedbackEnabled || item.initiatedBy !== "system" || item.status !== "delivered") return null;
  const answered = learningAware.progressFeedback[item.id];
  if (answered) {
    return (
      <p className="mt-2 text-xs text-slate-500">
        {answered === "skip" ? "Skipped." : "Thanks, your answer was saved."}
      </p>
    );
  }
  if (!due) return null;
  const pending = busy === `${item.id}:progress`;
  const labelId = `progress-${item.id}`;
  return (
    <div role="group" aria-labelledby={labelId} className="mt-3 rounded-lg border border-slate-200 bg-white/80 p-2">
      <p id={labelId} className="text-xs font-medium text-slate-700">
        Did this help you make progress? <span className="font-normal text-slate-500">(optional, one click)</span>
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {OPTIONS.map(({ response, label }) => (
          <button
            key={response}
            type="button"
            disabled={pending}
            onClick={() => onAnswer(item.id, response)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
