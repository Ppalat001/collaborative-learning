"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProgressFeedbackPrompt } from "@/components/ProgressFeedbackPrompt";
import { buildGroupTimeline, type GroupTimelineEvent } from "@/lib/groupTimeline";
import { MAX_MESSAGE_LENGTH, PARTICIPANT_COLORS } from "@/lib/instruments";
import type {
  CheckpointView,
  ClientExposureKind,
  FeedbackAction,
  InterventionView,
  LearningAwareMemberState,
  ProgressFeedbackResponse,
  SharedIdeaView,
} from "@/lib/intervention/types";
import type { DiscussionMessage } from "@/lib/types";

const UNKNOWN_COLOR = { name: "text-slate-600", bubble: "border-slate-200 bg-slate-50" };
const AI_NAME = "AI Collaboration Assistant";
/** Distance from the bottom (px) that still counts as "reading the newest messages". */
const BOTTOM_SLACK = 48;

function colorFor(index: number) {
  return index >= 0 ? PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length] : UNKNOWN_COLOR;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Non-AI discussion prompts (V2 checkpoints). They are shown in the chat timeline
 * but stored separately, so they never count as chat messages.
 */
export interface DiscussionPromptsConfig {
  kinds: { kind: string; text: string }[];
  raised: CheckpointView[];
  busy: boolean;
  onRaise: (kind: string) => void;
}

/**
 * Group AI in the chat (V2): replies, offers and shared private excerpts are
 * rendered in the same timeline but come from their own tables, so they never
 * count as chat messages.
 */
export interface GroupAssistantConfig {
  /** The Step 1 buttons; empty when the condition has no manual group help. */
  buttons: { type: string; label: string; shortLabel: string }[];
  items: InterventionView[];
  sharedIdeas: SharedIdeaView[];
  busy: string | null;
  error: string | null;
  /** Server-derived wait for this member's next group request. */
  cooldown: { until: number; seconds: number } | null;
  learningAware: LearningAwareMemberState | null;
  onRequest: (supportType: string) => void;
  onRespond: (id: string, action: FeedbackAction) => void;
  onViewed: (id: string) => void;
  onExposure?: (id: string, kind: ClientExposureKind) => void;
  onProgressFeedback?: (id: string, response: ProgressFeedbackResponse) => void;
}

interface DiscussionChatProps {
  scenarioOrder: number;
  messages: DiscussionMessage[];
  participantId: string | null;
  disabled: boolean;
  onSend: (text: string) => Promise<void>;
  prompts?: DiscussionPromptsConfig | null;
  assistant?: GroupAssistantConfig | null;
}

function isOpenOffer(item: InterventionView) {
  return item.initiatedBy === "system" && (item.status === "suggested" || item.status === "deferred");
}

/** "Not now" (older policies): hidden for this member until the deferral ends. */
function isDeferredForMe(item: InterventionView, now: number) {
  return item.myFeedback === "deferred" && !!item.deferredUntil && Date.parse(item.deferredUntil) > now;
}

/** "Hide for me" (per-member policies): the offer stays open for the others. */
function isHiddenForMe(item: InterventionView, perMember: boolean) {
  return perMember && item.myFeedback === "dismissed" && isOpenOffer(item);
}

function tracksExposure(item: InterventionView, now: number, perMember: boolean) {
  if (item.initiatedBy !== "system") return false;
  if (item.status === "delivered") return true;
  return isOpenOffer(item) && !isDeferredForMe(item, now) && !isHiddenForMe(item, perMember);
}

function originNote(aiOrigin: string | null) {
  if (aiOrigin === "mock") return "Demo text (no AI service)";
  if (aiOrigin === "template_fallback") return "Template fallback";
  if (aiOrigin === "real") return "AI generated";
  return null;
}

function BotIcon() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-600 text-[10px] font-bold text-white"
    >
      AI
    </span>
  );
}

function eventSeenKey(event: GroupTimelineEvent) {
  return `${event.key}:${event.kind}`;
}

export function DiscussionChat({
  scenarioOrder,
  messages,
  participantId,
  disabled,
  onSend,
  prompts,
  assistant,
}: DiscussionChatProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pinned, setPinned] = useState(true);
  const [seenWhenLeft, setSeenWhenLeft] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const lastKeyRef = useRef<string | null>(null);
  const perMember = assistant?.learningAware?.dismissal === "per_member";
  const cooldown = assistant?.cooldown ?? null;
  const cooling = !!cooldown && cooldown.until > now;

  const events = useMemo(
    () =>
      buildGroupTimeline({
        scenarioOrder,
        messages,
        groupItems: assistant?.items ?? [],
        sharedIdeas: assistant?.sharedIdeas ?? [],
        prompts: prompts?.raised ?? [],
      }),
    [scenarioOrder, messages, assistant?.items, assistant?.sharedIdeas, prompts?.raised]
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), cooling ? 1000 : 5000);
    return () => clearInterval(timer);
  }, [cooling]);

  // Stay at the newest message while the reader is there; never pull them away
  // from older messages, except right after they sent one themselves.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const last = events.at(-1);
    const mineJustSent =
      !!last &&
      last.key !== lastKeyRef.current &&
      last.kind === "human_message" &&
      !!participantId &&
      last.message.participantId === participantId;
    lastKeyRef.current = last?.key ?? null;
    if (pinned || mineJustSent) list.scrollTop = list.scrollHeight;
  }, [events, pinned, participantId]);

  const unread = pinned
    ? 0
    : events.filter(
        (event) =>
          !seenWhenLeft.has(eventSeenKey(event)) &&
          !(event.kind === "human_message" && event.message.participantId === participantId)
      ).length;

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < BOTTOM_SLACK;
    if (atBottom === pinned) return;
    if (!atBottom) setSeenWhenLeft(new Set(events.map(eventSeenKey)));
    setPinned(atBottom);
  };

  const jumpToNewest = () => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    setPinned(true);
  };

  const onViewed = assistant?.onViewed;
  useEffect(() => {
    if (!onViewed || disabled) return;
    for (const item of assistant?.items ?? []) {
      if (item.status === "suggested" && !isDeferredForMe(item, now) && !isHiddenForMe(item, perMember)) {
        onViewed(item.id);
      }
    }
  }, [assistant?.items, now, onViewed, perMember, disabled]);

  // policy-v2-3+: an AI item counts as displayed only when at least half of it is
  // visible inside the chat box, in a visible browser tab.
  const onExposure = assistant?.onExposure;
  const exposureEnabled = !!assistant?.learningAware?.enabled;
  useEffect(() => {
    const root = listRef.current;
    if (!exposureEnabled || !onExposure || !root || typeof IntersectionObserver === "undefined") return;
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
      { root, threshold: [0, 0.5, 1] }
    );
    root.querySelectorAll<HTMLElement>("[data-exposure-id]").forEach((element) => observer.observe(element));
    document.addEventListener("visibilitychange", report);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", report);
    };
  }, [events, now, exposureEnabled, onExposure]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const groupBusy = assistant?.busy?.startsWith("group:") ?? false;
  const waitSeconds = cooling && cooldown ? Math.min(cooldown.seconds, Math.ceil((cooldown.until - now) / 1000)) : 0;

  return (
    <div className="mt-3">
      <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
        <h3 className="font-semibold text-indigo-900">
          Team discussion — questions, unclarities and aligning your answer
        </h3>
        <p className="mt-1 text-sm text-slate-700">
          Use this chat to talk through the scenario&apos;s questions, clear up anything
          that is unclear, and align as a group. If members give different answers, or
          someone wants to update the group answer, discuss it here first so you can agree
          on one version. Each message shows who wrote it in their own colour.
        </p>
        {assistant && (
          <p className="mt-1 text-sm text-slate-700">
            Messages marked <strong>{AI_NAME}</strong> come from the AI, not from a group member. Everyone in
            your group sees them. The AI helps you work together; it does not give the answer.
          </p>
        )}
        <p className="mt-1 text-xs font-medium text-amber-800">
          Keep all group communication here: no external calls or messaging apps (e.g.
          Skype, Zoom, Teams, WhatsApp).
        </p>
      </div>
      <div className="relative">
        <div
          ref={listRef}
          onScroll={onScroll}
          role="log"
          aria-label="Group chat"
          className="max-h-96 min-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3"
        >
          {events.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              {prompts
                ? "No messages yet. Write a message below, or start with one of the discussion prompts."
                : "No messages yet. Start the discussion below."}
            </p>
          )}
          {events.map((event) => {
            switch (event.kind) {
              case "human_message":
                return <HumanMessage key={event.key} message={event.message} participantId={participantId} />;
              case "discussion_prompt":
                return <PromptLine key={event.key} prompt={event.prompt} />;
              case "shared_ai_excerpt":
                return <SharedExcerpt key={event.key} excerpt={event.excerpt} participantId={participantId} />;
              case "group_ai_message":
                return (
                  <AssistantMessage
                    key={event.key}
                    item={event.item}
                    at={event.at}
                    exposed={tracksExposure(event.item, now, perMember)}
                    locked={disabled}
                    canRetry={!!assistant?.buttons.length}
                    assistant={assistant ?? null}
                  />
                );
              case "group_ai_offer":
                return (
                  <OfferLine
                    key={event.key}
                    item={event.item}
                    now={now}
                    perMember={perMember}
                    locked={disabled}
                    exposed={tracksExposure(event.item, now, perMember)}
                    assistant={assistant ?? null}
                  />
                );
            }
          })}
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={jumpToNewest}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white shadow-md hover:bg-indigo-700"
          >
            {unread} new {unread === 1 ? "message" : "messages"} below
          </button>
        )}
      </div>

      {!disabled && prompts && prompts.kinds.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-slate-500">
            Discussion prompts: pick a question to put to the whole group (no AI involved).
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {prompts.kinds.map(({ kind, text }) => (
              <button
                key={kind}
                type="button"
                disabled={!participantId || prompts.busy}
                onClick={() => prompts.onRaise(kind)}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-left text-xs text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      )}

      {!disabled && assistant && assistant.buttons.length > 0 && (
        <div
          role="group"
          aria-labelledby="group-ai-toolbar-label"
          className="mt-3 rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-2"
        >
          <p id="group-ai-toolbar-label" className="flex items-center gap-1.5 text-xs text-violet-900">
            <BotIcon />
            <span>
              Ask the {AI_NAME}. The reply appears in this chat for everyone.
            </span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {assistant.buttons.map(({ type, label, shortLabel }) => (
              <button
                key={type}
                type="button"
                title={label}
                disabled={!participantId || groupBusy || cooling}
                onClick={() => assistant.onRequest(type)}
                className="rounded-lg border border-violet-300 bg-white px-3 py-1 text-sm text-violet-800 hover:bg-violet-100 disabled:opacity-50"
              >
                {assistant.busy === `group:${type}` ? "Asking..." : shortLabel}
              </button>
            ))}
          </div>
          {cooling && (
            <p role="status" className="mt-1.5 text-xs text-slate-600">
              You can ask the group AI again in {waitSeconds} second{waitSeconds === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      )}
      {assistant?.error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {assistant.error}
        </p>
      )}

      {!disabled && (
        <div className="mt-3 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={2}
            disabled={!participantId}
            aria-label="Message to your group"
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2"
            placeholder={
              participantId
                ? "Write a message to your group (Enter to send, Shift+Enter for a new line)"
                : "Join the session from the home page to take part"
            }
          />
          <button
            type="button"
            onClick={send}
            disabled={!participantId || sending || !draft.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function HumanMessage({ message, participantId }: { message: DiscussionMessage; participantId: string | null }) {
  const color = colorFor(message.colorIndex);
  const isMine = !!participantId && message.participantId === participantId;
  return (
    <div className={`rounded-lg border px-3 py-2 ${color.bubble}`}>
      <div className="flex items-baseline gap-2 text-xs">
        <span className={`font-semibold ${color.name}`}>
          {message.authorName}
          {isMine ? " (you)" : ""}
        </span>
        <span className="text-slate-500">{formatTime(message.createdAt)}</span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{message.text}</p>
    </div>
  );
}

function PromptLine({ prompt }: { prompt: CheckpointView }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-100 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wide text-slate-600">Discussion prompt</span>
        <span>
          raised by <span className="font-medium text-slate-700">{prompt.raisedByName}</span>
        </span>
        <span>{formatTime(prompt.createdAt)}</span>
        <span>· No AI involved</span>
      </div>
      <p className="mt-0.5 text-sm font-medium text-slate-900">{prompt.text}</p>
    </div>
  );
}

function SharedExcerpt({ excerpt, participantId }: { excerpt: SharedIdeaView; participantId: string | null }) {
  const color = colorFor(excerpt.colorIndex);
  const isMine = !!participantId && excerpt.participantId === participantId;
  return (
    <div className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="text-sky-900">
          Shared by{" "}
          <span className={`font-semibold ${color.name}`}>
            {excerpt.authorName}
            {isMine ? " (you)" : ""}
          </span>{" "}
          · AI-assisted excerpt
        </span>
        <span className="text-slate-500">{formatTime(excerpt.createdAt)}</span>
        <span className="text-slate-500">
          · from {isMine ? "your" : "their"} private {excerpt.sourceLabel}
        </span>
      </div>
      <blockquote className="mt-1 border-l-4 border-sky-300 pl-3 text-sm whitespace-pre-line text-slate-800">
        {excerpt.sharedText}
      </blockquote>
    </div>
  );
}

function WhyButton({
  item,
  onRespond,
  label,
}: {
  item: InterventionView;
  onRespond: (id: string, action: FeedbackAction) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!open) onRespond(item.id, "why_viewed");
          setOpen((value) => !value);
        }}
        className="text-xs text-violet-700 underline"
      >
        {open ? "Hide explanation" : label}
      </button>
      {open && <p className="mt-1 w-full rounded-lg bg-violet-50 px-3 py-2 text-xs text-slate-700">{item.reasonExplanation}</p>}
    </>
  );
}

function AssistantMessage({
  item,
  at,
  exposed,
  locked,
  canRetry,
  assistant,
}: {
  item: InterventionView;
  at: string;
  exposed: boolean;
  locked: boolean;
  canRetry: boolean;
  assistant: GroupAssistantConfig | null;
}) {
  const origin = item.status === "delivered" ? originNote(item.aiOrigin) : null;
  return (
    <article
      aria-label={`Message from the ${AI_NAME}`}
      data-exposure-id={exposed ? item.id : undefined}
      className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <BotIcon />
        <span className="font-semibold text-violet-900">{AI_NAME}</span>
        <span className="text-slate-500">{formatTime(at)}</span>
        <span className="text-violet-800">· {item.supportLabel}</span>
        {item.initiatedBy === "participant" ? (
          <span className="text-slate-500">· Requested by {item.requestedByName ?? "a member"}</span>
        ) : (
          <span className="text-slate-500">· Group suggestion</span>
        )}
        {origin && (
          <span className="rounded border border-violet-200 bg-white px-1.5 text-[10px] text-slate-600">{origin}</span>
        )}
      </div>
      {item.status === "accepted" && (
        <p role="status" className="mt-1 text-sm text-slate-500">
          Writing a collaboration question...
        </p>
      )}
      {item.status === "delivered" && (
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{item.content}</p>
      )}
      {item.status === "failed" && (
        <p className="mt-1 text-sm text-amber-800">
          {item.failureReason ?? "The AI is unavailable right now."} Carry on with your discussion
          {canRetry && !locked ? ", or try one of the buttons again later." : "."}
        </p>
      )}
      {item.initiatedBy === "system" && assistant && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <WhyButton item={item} onRespond={assistant.onRespond} label="Why this suggestion?" />
        </div>
      )}
      {item.initiatedBy === "system" && assistant?.onProgressFeedback && !locked && (
        <ProgressFeedbackPrompt
          item={item}
          learningAware={assistant.learningAware}
          busy={assistant.busy}
          onAnswer={assistant.onProgressFeedback}
        />
      )}
    </article>
  );
}

function OfferLine({
  item,
  now,
  perMember,
  locked,
  exposed,
  assistant,
}: {
  item: InterventionView;
  now: number;
  perMember: boolean;
  locked: boolean;
  exposed: boolean;
  assistant: GroupAssistantConfig | null;
}) {
  const muted = (text: string) => <p className="py-0.5 text-center text-xs text-slate-400">{text}</p>;
  if (item.status === "expired") return muted("An AI group suggestion was not opened and has closed.");
  if (item.status === "dismissed") return muted("An AI group suggestion was closed.");
  if (isHiddenForMe(item, perMember)) return muted("You hid an AI group suggestion. The others can still open it.");
  if (isDeferredForMe(item, now)) return muted("You chose \"Not now\" for an AI group suggestion.");
  if (locked || !assistant) return muted("An AI group suggestion was not opened.");

  const pending = Boolean(assistant.busy?.startsWith(`${item.id}:`)) && assistant.busy !== `${item.id}:why_viewed`;
  const hideAction: FeedbackAction = perMember ? "dismissed" : "deferred";
  return (
    <article
      aria-label="AI group suggestion available"
      data-exposure-id={exposed ? item.id : undefined}
      className="rounded-lg border border-dashed border-violet-400 bg-white px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-2 text-xs">
        <BotIcon />
        <span className="font-semibold text-violet-900">AI group suggestion available</span>
        <span className="text-slate-500">{formatTime(item.createdAt)}</span>
      </div>
      <p className="mt-1 text-sm text-slate-800">{item.offerText}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => assistant.onRespond(item.id, "accepted")}
          className="rounded-lg bg-violet-600 px-3 py-1 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {assistant.busy === `${item.id}:accepted` ? "Opening..." : "Yes, show a collaboration question"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => assistant.onRespond(item.id, hideAction)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {perMember ? "Hide for me" : "Not now"}
        </button>
        <WhyButton item={item} onRespond={assistant.onRespond} label="Why this suggestion?" />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        If anyone says yes, the question appears here for everyone. {perMember ? "Hiding" : "\"Not now\""} only
        affects you.
      </p>
    </article>
  );
}
