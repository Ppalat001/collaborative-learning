import {
  AI_SUPPORT_OPTIONS,
  SUPPORT_LEVEL_LABELS,
  type IndividualScaffold,
  type ScaffoldingOption,
  type ScaffoldingType,
} from "@/lib/types";

interface ScaffoldingSelectorProps {
  scaffolds: IndividualScaffold[];
  loading: ScaffoldingType[];
  /** True once the scenario is finished: cached responses can still be toggled, new ones can't be requested. */
  locked: boolean;
  disabled: boolean;
  onToggle: (type: ScaffoldingType, select: boolean) => void;
}

const OPTION_GROUPS: {
  title: string;
  description: string;
  filter: (option: ScaffoldingOption) => boolean;
}[] = [
  {
    title: `Level 1 · ${SUPPORT_LEVEL_LABELS[1]}`,
    description: "A small push; you still do the thinking",
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

function AiReply({
  text,
  disabled,
  onHide,
}: {
  text: string;
  disabled: boolean;
  onHide: () => void;
}) {
  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-800">AI response</p>
        <button
          type="button"
          onClick={onHide}
          disabled={disabled}
          className="text-xs font-medium text-amber-900 underline hover:text-amber-950 disabled:opacity-50"
        >
          Hide
        </button>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-slate-900">{text}</p>
    </div>
  );
}

export function ScaffoldingSelector({
  scaffolds,
  loading,
  locked,
  disabled,
  onToggle,
}: ScaffoldingSelectorProps) {
  const byType = new Map(scaffolds.map((s) => [s.scaffoldingType, s]));

  return (
    <div className="space-y-4">
      {OPTION_GROUPS.map((group) => {
        const options = AI_SUPPORT_OPTIONS.filter(group.filter);
        return (
          <div key={group.title}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
              <span className="text-xs text-slate-500">{group.description}</span>
            </div>
            <div className="mt-2 space-y-3">
              {options.map((option) => {
                const scaffold = byType.get(option.type);
                const isSelected = !!scaffold?.selected;
                const isLoading = loading.includes(option.type);
                const unavailable = locked && !scaffold;
                return (
                  <div key={option.type} className="flex flex-col gap-2">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      disabled={disabled || isLoading || unavailable}
                      onClick={() => onToggle(option.type, !isSelected)}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? "border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200"
                          : "border-slate-200 bg-white hover:border-indigo-300"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span
                        aria-hidden
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold ${
                          isSelected
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-slate-300 bg-white text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span>
                        <span className="block font-medium text-slate-900">{option.label}</span>
                        <span className="mt-1 block text-sm text-slate-600">
                          {isLoading ? "Asking the AI..." : option.description}
                        </span>
                      </span>
                    </button>
                    {isSelected && scaffold && (
                      <AiReply
                        text={scaffold.aiResponse}
                        disabled={disabled}
                        onHide={() => onToggle(option.type, false)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
