interface SurveyFormProps {
  onSubmit: (ratings: {
    autonomyRating: number;
    satisfactionRating: number;
    collaborationRating: number;
    perceivedHelpfulness: number;
    openReflection: string;
  }) => Promise<void>;
}

const fields = [
  { key: "autonomyRating", label: "I felt in control of our learning (autonomy)" },
  { key: "satisfactionRating", label: "I was satisfied with this scenario" },
  { key: "collaborationRating", label: "Our group collaborated effectively" },
  { key: "perceivedHelpfulness", label: "The AI support was helpful when used" },
] as const;

export function SurveyForm({ onSubmit }: SurveyFormProps) {
  return (
    <form
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await onSubmit({
          autonomyRating: Number(form.get("autonomyRating")),
          satisfactionRating: Number(form.get("satisfactionRating")),
          collaborationRating: Number(form.get("collaborationRating")),
          perceivedHelpfulness: Number(form.get("perceivedHelpfulness")),
          openReflection: String(form.get("openReflection") ?? ""),
        });
      }}
    >
      <h3 className="text-lg font-semibold text-slate-900">Quick reflection</h3>
      {fields.map((field) => (
        <label key={field.key} className="block space-y-1">
          <span className="text-sm text-slate-700">{field.label}</span>
          <select
            name={field.key}
            required
            defaultValue=""
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="" disabled>
              Select 1–5
            </option>
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
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
        className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
      >
        Save reflection
      </button>
    </form>
  );
}
