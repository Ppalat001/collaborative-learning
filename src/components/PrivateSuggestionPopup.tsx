"use client";

import { useEffect, useState } from "react";
import { ProgressFeedbackPrompt } from "@/components/ProgressFeedbackPrompt";
import type {
  ClientExposureKind,
  FeedbackAction,
  InterventionView,
  LearningAwareMemberState,
  ProgressFeedbackResponse,
} from "@/lib/intervention/types";

type Respond = (id: string, action: FeedbackAction) => void;

/**
 * Private pop-up offers chosen by this member's learner model (proactive_adaptive).
 * Only this member receives them. Nothing is generated until they click Yes; the
 * help then stays readable in Step 2 (AcceptedSuggestions).
 */
export function PrivateSuggestionPopup({
  items,
  locked,
  busy,
  onRespond,
  onViewed,
  learningAware = null,
  onExposure,
  onStop,
}: {
  items: InterventionView[];
  locked: boolean;
  busy: string | null;
  onRespond: Respond;
  onViewed: (id: string) => void;
  learningAware?: LearningAwareMemberState | null;
  onExposure?: (id: string, kind: ClientExposureKind) => void;
  onStop?: (id: string) => void;
}) {
  const [opened, setOpened] = useState<string[]>([]);
  const [closed, setClosed] = useState<string[]>([]);

  const offer = locked ? undefined : items.find((item) => item.status === "suggested");
  const shown = items.find((item) => opened.includes(item.id) && !closed.includes(item.id)) ?? offer ?? null;

  useEffect(() => {
    if (shown?.status === "suggested") onViewed(shown.id);
  }, [shown?.id, shown?.status, onViewed]);

  if (!shown) return null;
  return (
    <SuggestionCard
      key={shown.id}
      item={shown}
      busy={busy}
      onAccept={() => {
        setOpened((current) => [...current, shown.id]);
        onRespond(shown.id, "accepted");
      }}
      onRespond={onRespond}
      onClose={() => setClosed((current) => [...current, shown.id])}
      onExposure={learningAware?.enabled ? onExposure : undefined}
      onStop={learningAware?.enabled ? onStop : undefined}
    />
  );
}

function SuggestionCard({
  item,
  busy,
  onAccept,
  onRespond,
  onClose,
  onExposure,
  onStop,
}: {
  item: InterventionView;
  busy: string | null;
  onAccept: () => void;
  onRespond: Respond;
  onClose: () => void;
  onExposure?: (id: string, kind: ClientExposureKind) => void;
  onStop?: (id: string) => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const pending = busy?.startsWith(`${item.id}:`) ?? false;
  const titleId = `suggestion-${item.id}`;

  // The card is fixed on screen, so it is displayed whenever the tab itself is visible.
  useEffect(() => {
    if (!onExposure || item.status !== "suggested") return;
    const report = () => {
      if (document.visibilityState === "visible") onExposure(item.id, "client_displayed_in_viewport");
    };
    report();
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [item.id, item.status, onExposure]);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-live="polite"
      className="fixed right-4 bottom-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border-2 border-indigo-500 bg-white p-4 shadow-xl"
    >
      <p id={titleId} className="text-xs font-semibold tracking-wide text-indigo-700">
        Private AI suggestion — only you can see this
      </p>

      {item.status === "suggested" && (
        <>
          <p className="mt-2 text-sm text-slate-900">{item.offerText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={onAccept}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Yes, show me
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onRespond(item.id, "deferred")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Not now
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onRespond(item.id, "dismissed")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              No thanks
            </button>
          </div>
          {onStop && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onStop(item.id)}
              className="mt-2 block text-xs text-slate-600 underline hover:text-slate-800 disabled:opacity-50"
            >
              Don&apos;t suggest again in this scenario
            </button>
          )}
        </>
      )}

      {item.status === "accepted" && <p className="mt-2 text-sm text-slate-600">Preparing your {item.supportLabel.toLowerCase()}...</p>}

      {item.status === "delivered" && (
        <>
          <p className="mt-2 text-xs font-medium text-indigo-800">
            {item.supportLabel}
            {item.aiOrigin === "mock" && " · demo text (no AI service)"}
          </p>
          <p className="mt-1 text-sm whitespace-pre-line text-slate-900">{item.content}</p>
          <p className="mt-2 text-xs text-slate-500">This is also kept in Step 2, so you can read it again later.</p>
        </>
      )}

      {item.status === "failed" && (
        <p className="mt-2 text-sm text-amber-800">{item.failureReason ?? "The AI is unavailable right now."}</p>
      )}

      {(item.status === "delivered" || item.status === "failed" || item.status === "expired" || item.status === "dismissed") && (
        <button
          type="button"
          onClick={onClose}
          className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Close
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          if (!showWhy) onRespond(item.id, "why_viewed");
          setShowWhy((value) => !value);
        }}
        className="mt-3 block text-xs text-indigo-700 underline"
      >
        {showWhy ? "Hide explanation" : "Why am I seeing this?"}
      </button>
      {showWhy && <p className="mt-1 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-slate-700">{item.reasonExplanation}</p>}
    </div>
  );
}

/** Read-only copy in Step 2 of the pop-up help this member accepted. Not an extra option. */
export function AcceptedSuggestions({
  items,
  learningAware = null,
  locked = false,
  busy = null,
  onProgressFeedback,
}: {
  items: InterventionView[];
  learningAware?: LearningAwareMemberState | null;
  locked?: boolean;
  busy?: string | null;
  onProgressFeedback?: (id: string, response: ProgressFeedbackResponse) => void;
}) {
  const delivered = items.filter((item) => item.status === "delivered" && item.content);
  if (delivered.length === 0) return null;
  return (
    <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
      <p className="text-sm font-medium text-slate-900">Suggested help you accepted</p>
      <p className="mt-1 text-xs text-slate-600">From the private pop-up suggestions. Only you can see these.</p>
      <ul className="mt-3 space-y-3">
        {delivered.map((item) => (
          <li key={item.id} className="rounded-lg border border-indigo-200 bg-white p-3">
            <p className="text-xs text-indigo-800">
              <strong>{item.supportLabel}</strong>
              {item.aiOrigin === "mock" && " · demo text (no AI service)"}
            </p>
            <p className="mt-1 text-sm whitespace-pre-line text-slate-900">{item.content}</p>
            {onProgressFeedback && !locked && (
              <ProgressFeedbackPrompt item={item} learningAware={learningAware} busy={busy} onAnswer={onProgressFeedback} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
