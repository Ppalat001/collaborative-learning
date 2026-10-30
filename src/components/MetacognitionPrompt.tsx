"use client";

import {
  CONFIDENCE_LABELS,
  METACOGNITIVE_ANSWER_MAX_LENGTH,
  METACOGNITIVE_PROMPTS,
} from "@/lib/instruments";

export interface MetacognitionAnswers {
  answerConfidence: number;
  confidenceReason: string;
  doDifferently: string;
}

interface MetacognitionPromptProps {
  finalAnswer: string;
  onContinue: (answers: MetacognitionAnswers) => void;
}

function PromptLabel({ label, text }: { label: string; text: string }) {
  return (
    <span className="block text-sm text-slate-900">
      <span className="mr-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-700">
        {label}
      </span>
      {text}
    </span>
  );
}

export function MetacognitionPrompt({ finalAnswer, onContinue }: MetacognitionPromptProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metacognition-title"
    >
      <form
        className="max-h-[90vh] w-full max-w-xl space-y-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onContinue({
            answerConfidence: Number(form.get("answerConfidence")),
            confidenceReason: String(form.get("confidenceReason") ?? "").trim(),
            doDifferently: String(form.get("doDifferently") ?? "").trim(),
          });
        }}
      >
        <div>
          <p className="text-sm font-medium text-indigo-600">Before you continue</p>
          <h2 id="metacognition-title" className="mt-1 text-xl font-semibold text-slate-900">
            Evaluation and reflection
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Your group agreed on its final answer. Before you continue, step back and think
            about it on your own: how confident you are, and what the group could have done
            differently. Only the research team sees these answers.
          </p>
        </div>

        <details className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">
            Show your group&apos;s final answer
          </summary>
          <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-slate-800">
            {finalAnswer}
          </p>
        </details>

        <fieldset>
          <legend>
            <PromptLabel {...METACOGNITIVE_PROMPTS.confidence} />
          </legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CONFIDENCE_LABELS.map((label, index) => (
              <label
                key={label}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:border-indigo-300"
              >
                <input type="radio" name="answerConfidence" value={index + 1} required />
                {index + 1} · {label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block space-y-1">
          <PromptLabel {...METACOGNITIVE_PROMPTS.confidenceReason} />
          <textarea
            name="confidenceReason"
            rows={3}
            required
            maxLength={METACOGNITIVE_ANSWER_MAX_LENGTH}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="e.g. we checked it against the task, or we were unsure about one part..."
          />
        </label>

        <label className="block space-y-1">
          <PromptLabel {...METACOGNITIVE_PROMPTS.doDifferently} />
          <textarea
            name="doDifferently"
            rows={3}
            required
            maxLength={METACOGNITIVE_ANSWER_MAX_LENGTH}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="e.g. discuss longer before asking the AI, include everyone's view..."
          />
        </label>

        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
        >
          Continue to my rating
        </button>
      </form>
    </div>
  );
}
