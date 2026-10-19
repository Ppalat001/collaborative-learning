"use client";

import { useState } from "react";
import { OPEN_ANSWER_MAX_LENGTH } from "@/lib/utils/assessment";

interface AssessmentFormProps {
  title: string;
  description: string;
  questions: {
    id: string;
    text: string;
    options: string[];
  }[];
  openQuestions: { id: string; text: string }[];
  submitLabel: string;
  /** Resolves to an error message to show, or null when saved. */
  onSubmit: (
    answers: Record<string, number>,
    openAnswers: Record<string, string>
  ) => Promise<string | null>;
}

export function AssessmentForm({
  title,
  description,
  questions,
  openQuestions,
  submitLabel,
  onSubmit,
}: AssessmentFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const answers: Record<string, number> = {};
        for (const question of questions) {
          answers[question.id] = Number(form.get(question.id));
        }
        const openAnswers: Record<string, string> = {};
        for (const question of openQuestions) {
          openAnswers[question.id] = String(form.get(question.id) ?? "").trim();
        }
        setError(null);
        setSubmitting(true);
        try {
          setError(await onSubmit(answers, openAnswers));
        } catch {
          setError("Could not save your answers. Please try again.");
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      </div>

      {questions.map((question, index) => (
        <fieldset key={question.id} className="space-y-2">
          <legend className="text-sm font-medium text-slate-900">
            {index + 1}. {question.text}
          </legend>
          <div className="space-y-2">
            {question.options.map((option, optionIndex) => (
              <label
                key={optionIndex}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:border-indigo-300"
              >
                <input
                  type="radio"
                  name={question.id}
                  value={optionIndex}
                  required
                  className="mt-1"
                />
                <span className="text-sm text-slate-700">{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {openQuestions.length > 0 && (
        <div className="space-y-4 border-t border-slate-200 pt-5">
          <p className="text-sm text-slate-600">
            Answer in your own words. A few sentences is enough; there is no right or
            wrong answer.
          </p>
          {openQuestions.map((question, index) => (
            <label key={question.id} className="block space-y-1">
              <span className="text-sm font-medium text-slate-900">
                {questions.length + index + 1}. {question.text}
              </span>
              <textarea
                name={question.id}
                rows={4}
                required
                maxLength={OPEN_ANSWER_MAX_LENGTH}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {submitting ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
