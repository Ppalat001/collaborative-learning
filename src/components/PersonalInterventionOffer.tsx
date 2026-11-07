"use client";

import { useEffect, useState } from "react";
import { InterventionFeedbackControls } from "@/components/InterventionFeedbackControls";
import type { FeedbackAction, InterventionView } from "@/lib/intervention/types";

/**
 * Private, opt-in AI coach (dual_adaptive). Only this member sees these items.
 * Nothing is generated until the member accepts an offer.
 */
export function PersonalInterventionOffer({
  items,
  optIn,
  locked,
  busy,
  recommendation,
  onToggleOptIn,
  onStuck,
  onRespond,
  onViewed,
  onShare,
}: {
  items: InterventionView[];
  optIn: boolean;
  locked: boolean;
  busy: string | null;
  recommendation: { label: string; rationale: string; fadingApplied: boolean } | null;
  onToggleOptIn: (value: boolean) => void;
  onStuck: () => void;
  onRespond: (id: string, action: FeedbackAction) => void;
  onViewed: (id: string) => void;
  onShare?: (view: InterventionView) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const hidden = (view: InterventionView) =>
    view.status === "deferred" && !!view.deferredUntil && Date.parse(view.deferredUntil) > now;

  useEffect(() => {
    for (const item of items) {
      if ((item.status === "suggested" || item.status === "deferred") && !hidden(item)) onViewed(item.id);
    }
  });

  const visible = items.filter((item) => item.status !== "dismissed" && item.status !== "expired");

  return (
    <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
      <p className="text-sm font-medium text-slate-900">Private AI coach (just for you)</p>
      <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="mt-1"
          checked={optIn}
          disabled={busy === "preferences"}
          onChange={(e) => onToggleOptIn(e.target.checked)}
        />
        Offer me a small private hint when I write that I am stuck or unsure. You can switch this off at any time.
      </label>
      {recommendation && (
        <p className="mt-2 text-xs text-slate-600">
          Suggested starting point: <strong>{recommendation.label}</strong>
          {recommendation.fadingApplied && " (lighter help, because you have been working well on your own)"}. You
          can still choose any option below.
        </p>
      )}
      {!locked && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={onStuck}
          className="mt-3 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-sm text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
        >
          {busy === "personal" ? "One moment..." : "I'm stuck"}
        </button>
      )}
      <ul className="mt-3 space-y-3">
        {visible.map((item) => (
          <li key={item.id} className="rounded-lg border border-indigo-200 bg-white p-3">
            <p className="text-xs text-indigo-800">
              <strong>Private AI coach</strong> · {item.supportLabel} · only you can see this
              {item.aiOrigin === "mock" && " · demo text (no AI service)"}
            </p>
            {(item.status === "suggested" || item.status === "deferred") &&
              (hidden(item) ? (
                <p className="mt-1 text-sm text-slate-500">You chose &quot;Not now&quot;. This will show again shortly.</p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-slate-800">{item.offerText}</p>
                  <InterventionFeedbackControls view={item} acceptLabel="Yes, show me" busy={busy} onRespond={onRespond} />
                </>
              ))}
            {item.status === "accepted" && <p className="mt-1 text-sm text-slate-500">Preparing...</p>}
            {item.status === "delivered" && (
              <>
                <p className="mt-1 text-sm whitespace-pre-line text-slate-900">{item.content}</p>
                {onShare && !locked && (
                  <button
                    type="button"
                    onClick={() => onShare(item)}
                    className="mt-2 text-xs text-indigo-700 underline"
                  >
                    Share an idea from this with my group
                  </button>
                )}
              </>
            )}
            {item.status === "failed" && (
              <p className="mt-1 text-sm text-amber-800">{item.failureReason ?? "The AI is unavailable right now."}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
