"use client";

import { useEffect, useState } from "react";
import type { ClientExposureKind, InterventionView } from "@/lib/intervention/types";

/** Open facilitator suggestions this member has not deferred or dismissed. */
export function pendingGroupSuggestions(items: InterventionView[], now: number): InterventionView[] {
  return items.filter(
    (item) =>
      item.scope === "group" &&
      item.initiatedBy === "system" &&
      (item.status === "suggested" || item.status === "deferred") &&
      item.myFeedback !== "dismissed" &&
      !(item.myFeedback === "deferred" && item.deferredUntil && Date.parse(item.deferredUntil) > now)
  );
}

/**
 * policy-v2-3: a small notice under the group chat when the shared facilitator
 * has a suggestion, so it is not missed while members are typing. "Show me"
 * moves focus to the suggestion card; "Hide" only hides this notice for this member.
 */
export function GroupSuggestionIndicator({
  items,
  onExposure,
}: {
  items: InterventionView[];
  onExposure: (id: string, kind: ClientExposureKind) => void;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const pending = pendingGroupSuggestions(items, now).filter((item) => !hidden.includes(item.id));
  const latest = pending.at(-1);

  return (
    <div aria-live="polite" role="status" className="mt-3">
      {latest && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2">
          <p className="text-sm text-violet-900">
            <span className="mr-1.5 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
              AI
            </span>
            The group facilitator has a suggestion for your group.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onExposure(latest.id, "user_opened");
                const card = document.getElementById(`facilitator-item-${latest.id}`);
                card?.scrollIntoView({ behavior: "smooth", block: "center" });
                card?.focus({ preventScroll: true });
              }}
              className="rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700"
            >
              Show me
            </button>
            <button
              type="button"
              onClick={() => {
                onExposure(latest.id, "indicator_dismissed");
                setHidden((current) => [...current, latest.id]);
              }}
              className="rounded-md border border-violet-300 bg-white px-2.5 py-1 text-xs text-violet-800 hover:bg-violet-100"
            >
              Hide
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
