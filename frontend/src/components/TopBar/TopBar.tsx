import type { ExperimentInfo } from "../../api/tables";

interface TopBarProps {
  experiments: ExperimentInfo[];
  selected: string | null;
  emptyLabel: string;
  onSelect: (id: string) => void;
}

/** App name + experiment picker. Nothing else. */
export function TopBar({
  experiments,
  selected,
  emptyLabel,
  onSelect,
}: TopBarProps) {
  const disabled = experiments.length === 0;
  return (
    <header className="flex items-center gap-6 border-b border-border-hairline bg-bg-panel px-6 py-3">
      <h1 className="font-mono text-base text-text-primary">RunoGraph</h1>
      <select
        aria-label="Experiment"
        value={selected ?? ""}
        disabled={disabled}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded border border-border-hairline bg-bg-sunken px-2 py-1 font-mono text-sm text-text-primary focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:text-text-disabled"
      >
        {disabled && <option value="">{emptyLabel}</option>}
        {!disabled && selected === null && (
          <option value="" disabled>
            Invalid experiment
          </option>
        )}
        {experiments.map((exp) => (
          <option key={exp.experiment_id} value={exp.experiment_id}>
            {exp.experiment_id} · {exp.run_count} runs
          </option>
        ))}
      </select>
    </header>
  );
}
