"use client";

import { useState } from "react";
import {
  LIKERT_LABELS,
  SUPPORT_AMOUNTS,
  SURVEY_SECTIONS,
  type SurveyRatingKey,
} from "@/lib/instruments";

export type SurveyAnswers = Partial<Record<SurveyRatingKey, number | null>> & {
  supportAmount: string | null;
  openReflection: string;
};

interface SurveyFormProps {
  aiUsed: boolean;
  canSubmit: boolean;
  onSubmit: (answers: SurveyAnswers) => Promise<void>;
}

export function SurveyForm({ aiUsed, canSubmit, onSubmit }: SurveyFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const sections = SURVEY_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => aiUsed || !item.aiOnly),
  })).filter((section) => section.items.length > 0);

  return (
    <form
      className="space-y-6 rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const answers: SurveyAnswers = {
          supportAmount: aiUsed ? String(form.get("supportAmount") ?? "") : null,
          openReflection: String(form.get("openReflection") ?? ""),
        };
        for (const item of sections.flatMap((s) => s.items)) {
          const value = String(form.get(item.key) ?? "");
          answers[item.key] = value === "na" || value === "" ? null : Number(value);
        }
        setSubmitting(true);
        try {
          await onSubmit(answers);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Your individual rating</h3>
        <p className="mt-1 text-sm text-slate-600">
          Every group member answers this on their own device. Answer for yourself,
          not for the group.
        </p>
      </div>

      {aiUsed && (
        <fieldset>
          <legend className="text-sm font-medium text-slate-900">
            The amount of AI support was:
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUPPORT_AMOUNTS.map((amount) => (
              <label
                key={amount.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-indigo-300"
              >
                <input type="radio" name="supportAmount" value={amount.id} required />
                {amount.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {sections.map((section) => (
        <div key={section.title} className="space-y-3">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-indigo-700">
            {section.title}
          </h4>
          {section.items.map((item) => (
            <fieldset key={item.key}>
              <legend className="text-sm text-slate-800">{item.label}</legend>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {LIKERT_LABELS.map((label, index) => (
                  <label
                    key={label}
                    title={label}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 hover:border-indigo-300"
                  >
                    <input type="radio" name={item.key} value={index + 1} required />
                    {index + 1} · {label}
                  </label>
                ))}
                {item.allowNotApplicable && (
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:border-indigo-300">
                    <input type="radio" name={item.key} value="na" required />
                    Not applicable
                  </label>
                )}
              </div>
            </fieldset>
          ))}
        </div>
      ))}

      <label className="block space-y-1">
        <span className="text-sm text-slate-700">
          Optional: What stood out about this scenario or the AI support?
        </span>
        <textarea
          name="openReflection"
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3 py-2"
          placeholder="Share any brief reflection for the research team..."
        />
      </label>

      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? "Saving..." : "Save my rating and continue"}
      </button>
    </form>
  );
}
