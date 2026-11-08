"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH, PARTICIPANT_COLORS } from "@/lib/instruments";
import type { CheckpointView } from "@/lib/intervention/types";
import type { DiscussionMessage } from "@/lib/types";

const UNKNOWN_COLOR = { name: "text-slate-600", bubble: "border-slate-200 bg-slate-50" };

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

interface DiscussionChatProps {
  messages: DiscussionMessage[];
  participantId: string | null;
  disabled: boolean;
  onSend: (text: string) => Promise<void>;
  prompts?: DiscussionPromptsConfig | null;
}

type TimelineEntry =
  | { type: "message"; at: string; message: DiscussionMessage }
  | { type: "prompt"; at: string; prompt: CheckpointView };

export function DiscussionChat({
  messages,
  participantId,
  disabled,
  onSend,
  prompts,
}: DiscussionChatProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const timeline: TimelineEntry[] = [
    ...messages.map((message) => ({ type: "message" as const, at: message.createdAt, message })),
    ...(prompts?.raised ?? []).map((prompt) => ({ type: "prompt" as const, at: prompt.createdAt, prompt })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [timeline.length]);

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
        <p className="mt-1 text-xs font-medium text-amber-800">
          Keep all group communication here: no external calls or messaging apps (e.g.
          Skype, Zoom, Teams, WhatsApp).
        </p>
      </div>
      <div
        ref={listRef}
        className="max-h-96 min-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3"
      >
        {timeline.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">
            {prompts
              ? "No messages yet. Write a message below, or start with one of the discussion prompts."
              : "No messages yet. Start the discussion below."}
          </p>
        )}
        {timeline.map((entry) => {
          if (entry.type === "prompt") {
            const { prompt } = entry;
            return (
              <div
                key={`prompt-${prompt.id}`}
                className="rounded-lg border border-dashed border-slate-300 bg-slate-100 px-3 py-2"
              >
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
          const { message } = entry;
          const color = colorFor(message.colorIndex);
          const isMine = !!participantId && message.participantId === participantId;
          return (
            <div key={message.id} className={`rounded-lg border px-3 py-2 ${color.bubble}`}>
              <div className="flex items-baseline gap-2 text-xs">
                <span className={`font-semibold ${color.name}`}>
                  {message.authorName}
                  {isMine ? " (you)" : ""}
                </span>
                <span className="text-slate-500">{formatTime(message.createdAt)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                {message.text}
              </p>
            </div>
          );
        })}
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
