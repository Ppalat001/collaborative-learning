import {
  SCAFFOLDING_OPTIONS,
  SUPPORT_LEVEL_LABELS,
  type ScaffoldingOption,
  type ScaffoldingType,
} from "@/lib/types";

interface ScaffoldingSelectorProps {
  selected: ScaffoldingType | null;
  disabled: boolean;
  onSelect: (type: ScaffoldingType) => void;
}

const OPTION_GROUPS: {
  title: string;
  description: string;
  filter: (option: ScaffoldingOption) => boolean;
}[] = [
  {
    title: `Level 0 · ${SUPPORT_LEVEL_LABELS[0]}`,
    description: "Continue on your own",
    filter: (o) => o.supportLevel === 0,
  },
  {
    title: `Level 1 · ${SUPPORT_LEVEL_LABELS[1]}`,
    description: "A small push; your group does the thinking",
    filter: (o) => o.supportLevel === 1,
  },
  {
    title: `Level 2 · ${SUPPORT_LEVEL_LABELS[2]}`,
    description: "More guidance, but no final answer",
    filter: (o) => o.supportLevel === 2,
  },
  {
    title: `Level 3 · ${SUPPORT_LEVEL_LABELS[3]}`,
    description: "A complete answer to compare against",
    filter: (o) => o.supportLevel === 3,
  },
  {
    title: "Collaboration support",
    description: "Help with how your group works together, not the answer itself",
    filter: (o) => o.category === "process",
  },
];

export function ScaffoldingSelector({
  selected,
  disabled,
  onSelect,
}: ScaffoldingSelectorProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Choosing an option sends it to your group as a proposal. Options are
        grouped from least to most direct help. Your group gets one AI request
        per scenario.
      </p>
      {OPTION_GROUPS.map((group) => {
        const options = SCAFFOLDING_OPTIONS.filter(group.filter);
        return (
          <div key={group.title}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
              <span className="text-xs text-slate-500">{group.description}</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {options.map((option) => {
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
      })}
    </div>
  );
}
