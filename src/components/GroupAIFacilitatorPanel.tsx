"use client";

import { useEffect, useRef, useState } from "react";
import { InterventionFeedbackControls } from "@/components/InterventionFeedbackControls";
import { ProgressFeedbackPrompt } from "@/components/ProgressFeedbackPrompt";
import type {
  ClientExposureKind,
  FeedbackAction,
  InterventionView,
  LearningAwareMemberState,
  ProgressFeedbackResponse,
  SharedIdeaView,
} from "@/lib/intervention/types";

function time(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

function isHiddenForMe(view: InterventionView, now: number) {
  return view.myFeedback === "deferred" && !!view.deferredUntil && Date.parse(view.deferredUntil) > now;
}

/** Per-member dismissal (policy-v2-3+): the offer stays open for the others. */
function isDismissedByMe(view: InterventionView, perMember: boolean) {
  return perMember && view.myFeedback === "dismissed" && (view.status === "suggested" || view.status === "deferred");
}

function tracksExposure(view: InterventionView, now: number, perMember: boolean) {
  if (view.initiatedBy !== "system") return false;
  if (view.status === "delivered") return true;
  return (
    (view.status === "suggested" || view.status === "deferred") &&
    !isHiddenForMe(view, now) &&
    !isDismissedByMe(view, perMember)
  );
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
  learningAware = null,
  onExposure,
  onProgressFeedback,
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
  learningAware?: LearningAwareMemberState | null;
  onExposure?: (id: string, kind: ClientExposureKind) => void;
  onProgressFeedback?: (id: string, response: ProgressFeedbackResponse) => void;
}) {
  const perMember = learningAware?.dismissal === "per_member";
  const listRef = useRef<HTMLOListElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    for (const item of items) {
      if (item.status === "suggested" && !isHiddenForMe(item, now) && !isDismissedByMe(item, perMember)) {
        onViewed(item.id);
      }
    }
  }, [items, now, onViewed, perMember]);

  // policy-v2-3: an offer counts as displayed only when at least half of its card is on screen in a visible tab.
  useEffect(() => {
    const root = listRef.current;
    if (!learningAware?.enabled || !onExposure || !root || typeof IntersectionObserver === "undefined") return;
    const onScreen = new Set<string>();
    const report = () => {
      if (document.visibilityState !== "visible") return;
      for (const id of onScreen) onExposure(id, "client_displayed_in_viewport");
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.exposureId;
          if (!id) continue;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) onScreen.add(id);
          else onScreen.delete(id);
        }
        report();
      },
      { threshold: [0, 0.5, 1] }
    );
    root.querySelectorAll<HTMLElement>("[data-exposure-id]").forEach((element) => observer.observe(element));
    document.addEventListener("visibilitychange", report);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", report);
    };
  }, [items, now, learningAware?.enabled, onExposure]);

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
      <ol ref={listRef} className="mt-4 space-y-3">
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
            <li
              key={item.id}
              id={`facilitator-item-${item.id}`}
              tabIndex={-1}
              data-exposure-id={tracksExposure(item, now, perMember) ? item.id : undefined}
              className={`${facilitatorCardClass(item.status)} focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500`}
            >
              <p className="text-xs font-medium text-violet-900">
                {time(item.createdAt)} · <strong>AI facilitator</strong> · {item.supportLabel} · {origin}
                {item.aiOrigin === "mock" && " · demo text (no AI service)"}
              </p>
              {(item.status === "suggested" || item.status === "deferred") &&
                (isDismissedByMe(item, perMember) ? (
                  <p className="mt-2 text-sm text-slate-500">You dismissed this suggestion. It stays hidden for you.</p>
                ) : isHiddenForMe(item, now) ? (
                  <p className="mt-2 text-sm text-slate-500">You chose &quot;Not now&quot;. This will show again shortly.</p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-slate-800">{item.offerText}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {perMember
                        ? "If one member opens it, everyone sees it. Dismissing it only hides it for you."
                        : "If one member opens it, everyone sees it. If one member dismisses it, it closes for everyone."}
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
                  {onProgressFeedback && !locked && (
                    <ProgressFeedbackPrompt
                      item={item}
                      learningAware={learningAware}
                      busy={busy}
                      onAnswer={onProgressFeedback}
                    />
                  )}
                </>
              )}
              {item.status === "dismissed" && (
                <p className="mt-2 text-sm text-slate-500">
                  {perMember ? "Every member dismissed this suggestion." : "A member dismissed this suggestion."}
                </p>
              )}
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
