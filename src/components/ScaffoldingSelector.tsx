import { SCAFFOLDING_OPTIONS, type ScaffoldingType } from "@/lib/types";

interface ScaffoldingSelectorProps {
  selected: ScaffoldingType | null;
  disabled: boolean;
  onSelect: (type: ScaffoldingType) => void;
}

export function ScaffoldingSelector({
  selected,
  disabled,
  onSelect,
}: ScaffoldingSelectorProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Choose one type of AI support for this scenario. You can only request
        scaffolding once per scenario.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {SCAFFOLDING_OPTIONS.map((option) => {
          const isSelected = selected === option.type;
          return (
            <button
              key={option.type}
              type="button"
              disabled={disabled || (selected !== null && !isSelected)}
              onClick={() => onSelect(option.type)}
              className={`rounded-xl border p-3 text-left transition ${
                isSelected
                  ? "border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200"
                  : "border-slate-200 bg-white hover:border-indigo-300"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <div className="font-medium text-slate-900">{option.label}</div>
              <div className="mt-1 text-sm text-slate-600">
                {option.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
