"use client";

import { useRef } from "react";
import { charsByAuthor, toSegments } from "@/lib/authorship";
import { ANSWER_WORD_LIMIT, countWords, participantColor } from "@/lib/instruments";
import type { AuthorRun, GroupMember } from "@/lib/types";

interface GroupAnswerEditorProps {
  value: string;
  authorship: AuthorRun[];
  members: GroupMember[];
  participantId: string | null;
  readyIds: string[];
  submitted: boolean;
  readyBusy: boolean;
  onChange: (value: string) => void;
  onReadyChange: (ready: boolean) => void;
}

const TEXT_BOX = "px-4 py-3 text-base leading-7 font-sans whitespace-pre-wrap break-words";

export function GroupAnswerNote() {
  return (
    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">
      <p className="font-semibold text-sky-900">How the group answer works</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          Everyone in the group types in the same box below, at the same time. Each person&apos;s
          text is highlighted in <span className="font-medium">their own colour</span>, the same
          colour as in the chat.
        </li>
        <li>
          The <span className="font-medium">bar above the answer</span> lists every member with
          their colour, so you can see who wrote which part.
        </li>
        <li>
          The answer can be at most <span className="font-medium">{ANSWER_WORD_LIMIT} words</span>.
        </li>
        <li>
          When you are happy with the answer, click{" "}
          <span className="font-medium">&ldquo;I am good&rdquo;</span>. Your typing is paused while
          you are marked as good. Click it again to unselect it if you still want to edit something.
        </li>
        <li>
          The group moves on to the next question only when{" "}
          <span className="font-medium">every member</span>{" "}
          has selected &ldquo;I am good&rdquo;.
        </li>
      </ul>
    </div>
  );
}

export function GroupAnswerEditor({
  value,
  authorship,
  members,
  participantId,
  readyIds,
  submitted,
  readyBusy,
  onChange,
  onReadyChange,
}: GroupAnswerEditorProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const colorIndexById = new Map(members.map((m) => [m.id, m.colorIndex]));
  const isReady = !!participantId && readyIds.includes(participantId);
  const words = countWords(value);
  const totals = charsByAuthor(authorship);
  const totalChars = value.length;
  const canEdit = !!participantId && !submitted && !isReady;
  const readyCount = members.filter((m) => readyIds.includes(m.id)).length;

  const handleChange = (next: string) => {
    if (countWords(next) > ANSWER_WORD_LIMIT && countWords(next) >= words) return;
    onChange(next);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2" aria-label="Group members">
        {members.map((member) => {
          const color = participantColor(member.colorIndex);
          const ready = readyIds.includes(member.id);
          const chars = totals.get(member.id) ?? 0;
          const share = totalChars > 0 ? Math.round((chars / totalChars) * 100) : 0;
          return (
            <div
              key={member.id}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                color?.bubble ?? "border-slate-200 bg-slate-50"
              }`}
            >
              <span className={`h-3 w-3 rounded-full ${color?.dot ?? "bg-slate-400"}`} />
              <span className={`font-medium ${color?.name ?? "text-slate-700"}`}>
                {member.name}
                {member.id === participantId ? " (you)" : ""}
              </span>
              <span className="text-xs text-slate-500">{share}% of text</span>
              <span
                className={`text-xs font-medium ${ready ? "text-emerald-700" : "text-slate-500"}`}
              >
                {ready ? "✓ I am good" : "editing"}
              </span>
            </div>
          );
        })}
      </div>

      <div
        className={`relative mt-3 h-64 overflow-hidden rounded-xl border ${
          canEdit ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50"
        }`}
      >
        <div
          ref={backdropRef}
          aria-hidden
          className={`${TEXT_BOX} absolute inset-0 overflow-y-scroll text-slate-800`}
        >
          {toSegments(value, authorship).map((segment, index) => {
            const colorIndex =
              segment.participantId !== null ? colorIndexById.get(segment.participantId) : undefined;
            const color = colorIndex !== undefined ? participantColor(colorIndex) : null;
            return (
              <span key={index} className={`rounded-sm ${color?.highlight ?? ""}`}>
                {segment.text}
              </span>
            );
          })}
          {/* Keeps the backdrop as tall as the textarea when the text ends in a newline. */}
          {"\u200b"}
        </div>
        <textarea
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onScroll={(e) => {
            if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          readOnly={!canEdit}
          spellCheck={false}
          aria-label="Final group answer"
          placeholder={
            submitted
              ? ""
              : isReady
                ? "Unselect \"I am good\" to edit again."
                : "Start typing your group's answer here..."
          }
          className={`${TEXT_BOX} absolute inset-0 h-full w-full resize-none overflow-y-scroll border-0 bg-transparent text-transparent caret-slate-900 outline-none placeholder:text-slate-400 selection:bg-indigo-200/60`}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p
          className={`text-xs ${words >= ANSWER_WORD_LIMIT ? "font-medium text-red-600" : "text-slate-500"}`}
        >
          {words} / {ANSWER_WORD_LIMIT} words
        </p>
        <p className="text-sm text-slate-600">
          {readyCount} of {members.length} {members.length === 1 ? "member is" : "members are"} good
        </p>
      </div>

      {submitted ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          Everyone selected &ldquo;I am good&rdquo;, so this answer is final.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => onReadyChange(!isReady)}
          disabled={!participantId || readyBusy || (!isReady && !value.trim())}
          className={`mt-3 rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-50 ${
            isReady
              ? "border border-emerald-600 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
        >
          {readyBusy
            ? "Saving..."
            : isReady
              ? "✓ I am good (click to unselect and edit)"
              : "I am good"}
        </button>
      )}
    </div>
  );
}
