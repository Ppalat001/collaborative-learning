"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH, PARTICIPANT_COLORS } from "@/lib/instruments";
import type { DiscussionMessage } from "@/lib/types";

const UNKNOWN_COLOR = { name: "text-slate-600", bubble: "border-slate-200 bg-slate-50" };

function colorFor(index: number) {
  return index >= 0 ? PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length] : UNKNOWN_COLOR;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface DiscussionChatProps {
  messages: DiscussionMessage[];
  participantId: string | null;
  disabled: boolean;
  onSend: (text: string) => Promise<void>;
}

export function DiscussionChat({
  messages,
  participantId,
  disabled,
  onSend,
}: DiscussionChatProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

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
      <div
        ref={listRef}
        className="max-h-96 min-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3"
      >
        {messages.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">
            No messages yet. Start the discussion below.
          </p>
        )}
        {messages.map((message) => {
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
