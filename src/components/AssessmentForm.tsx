"use client";

interface AssessmentFormProps {
  title: string;
  description: string;
  questions: {
    id: string;
    text: string;
    options: string[];
  }[];
  submitLabel: string;
  onSubmit: (answers: Record<string, number>) => Promise<void>;
}

export function AssessmentForm({
  title,
  description,
  questions,
  submitLabel,
  onSubmit,
}: AssessmentFormProps) {
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
        await onSubmit(answers);
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

      <button
        type="submit"
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
      >
        {submitLabel}
      </button>
    </form>
  );
}
