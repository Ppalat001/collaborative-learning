"use client";

import { useEffect, useState } from "react";
import { InterventionFeedbackControls } from "@/components/InterventionFeedbackControls";
import type { FeedbackAction, InterventionView, SharedIdeaView } from "@/lib/intervention/types";

function time(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

function isHiddenForMe(view: InterventionView, now: number) {
  return view.myFeedback === "deferred" && !!view.deferredUntil && Date.parse(view.deferredUntil) > now;
}

function facilitatorCardClass(status: InterventionView["status"]) {
  const base = "rounded-xl border-2 p-4 shadow-sm";
  if (status === "expired" || status === "dismissed") {
    return `${base} border-slate-400 bg-slate-100`;
  }
  if (status === "failed") {
    return `${base} border-amber-400 bg-amber-50`;
  }
  if (status === "suggested" || status === "deferred") {
    return `${base} border-violet-500 bg-violet-100 shadow-md`;
  }
  return `${base} border-violet-400 bg-violet-100`;
}

/**
 * Shared AI facilitator timeline: visible to every member, visually distinct from
 * human chat, and never counted as a chat message.
 */
export function GroupAIFacilitatorPanel({
  items,
  sharedIdeas,
  manualTypes,
  locked,
  busy,
  error,
  onRequest,
  onRespond,
  onViewed,
}: {
  items: InterventionView[];
  sharedIdeas: SharedIdeaView[];
  manualTypes: { type: string; label: string }[];
  locked: boolean;
  busy: string | null;
  error: string | null;
  onRequest: (supportType: string) => void;
  onRespond: (id: string, action: FeedbackAction) => void;
  onViewed: (id: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    for (const item of items) {
      if (item.status === "suggested" && !isHiddenForMe(item, now)) onViewed(item.id);
    }
  }, [items, now, onViewed]);

  const timeline = [
    ...items.map((item) => ({ kind: "intervention" as const, at: item.createdAt, item })),
    ...sharedIdeas.map((idea) => ({ kind: "idea" as const, at: idea.createdAt, idea })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">
        <span className="mr-2 rounded-md bg-violet-600 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
          AI
        </span>
        Shared group facilitator
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Everyone in your group sees this panel. The facilitator helps you work together; it does not write your
        answer. AI items here are separate from your group chat.
      </p>

      {timeline.length === 0 && <p className="mt-4 text-sm text-slate-500">Nothing here yet.</p>}
      <ol className="mt-4 space-y-3">
        {timeline.map((entry) => {
          if (entry.kind === "idea") {
            const { idea } = entry;
            return (
              <li key={`idea-${idea.id}`} className="rounded-xl border-2 border-sky-400 bg-sky-50 p-4 shadow-sm">
                <p className="text-xs text-sky-900">
                  {time(idea.createdAt)} · <strong className="text-slate-700">{idea.authorName}</strong> shared an
                  idea from their private AI support ({idea.sourceLabel})
                </p>
                <blockquote className="mt-2 border-l-4 border-sky-400 pl-3 text-sm whitespace-pre-line text-slate-800">
                  {idea.sharedText}
                </blockquote>
              </li>
            );
          }
          const { item } = entry;
          const origin =
            item.initiatedBy === "participant"
              ? `Requested by ${item.requestedByName ?? "a member"}`
              : "Suggested by the facilitator";
          return (
            <li key={item.id} className={facilitatorCardClass(item.status)}>
              <p className="text-xs font-medium text-violet-900">
                {time(item.createdAt)} · <strong>AI facilitator</strong> · {item.supportLabel} · {origin}
                {item.aiOrigin === "mock" && " · demo text (no AI service)"}
              </p>
              {(item.status === "suggested" || item.status === "deferred") &&
                (isHiddenForMe(item, now) ? (
                  <p className="mt-2 text-sm text-slate-500">You chose &quot;Not now&quot;. This will show again shortly.</p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-slate-800">{item.offerText}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      If one member opens it, everyone sees it. If one member dismisses it, it closes for everyone.
                    </p>
                    <InterventionFeedbackControls
                      view={item}
                      acceptLabel="Show to the group"
                      busy={busy}
                      onRespond={onRespond}
                    />
                  </>
                ))}
              {item.status === "accepted" && (
                <p className="mt-2 text-sm text-slate-500">The facilitator is preparing a prompt...</p>
              )}
              {item.status === "delivered" && (
                <>
                  <p className="mt-2 text-sm whitespace-pre-line text-slate-900">{item.content}</p>
                  <InterventionFeedbackControls view={item} acceptLabel="" busy={busy} onRespond={onRespond} />
                </>
              )}
              {item.status === "dismissed" && <p className="mt-2 text-sm text-slate-500">A member dismissed this suggestion.</p>}
              {item.status === "expired" && <p className="mt-2 text-sm text-slate-500">This suggestion expired.</p>}
              {item.status === "failed" && (
                <p className="mt-2 text-sm text-amber-800">
                  {item.failureReason ?? "The AI facilitator is unavailable."} Carry on with your discussion.
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {manualTypes.length > 0 && !locked && (
        <div className="mt-5 border-t border-violet-200 pt-4">
          <p className="text-sm font-medium text-slate-800">Ask the group facilitator for collaboration help</p>
          <p className="text-xs text-slate-500">The result is shown to everyone in your group.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {manualTypes.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                disabled={busy !== null}
                onClick={() => onRequest(type)}
                className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-100 disabled:opacity-50"
              >
                {busy === `group:${type}` ? "Asking..." : label}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
