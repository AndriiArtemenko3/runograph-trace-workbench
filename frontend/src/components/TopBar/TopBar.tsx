import type { ExperimentInfo } from "../../api/tables";

interface TopBarProps {
  experiments: ExperimentInfo[];
  selected: string | null;
  onSelect: (id: string) => void;
}

/** App name + experiment picker. Nothing else. */
export function TopBar({ experiments, selected, onSelect }: TopBarProps) {
  return (
    <header className="flex items-center gap-6 border-b border-border-hairline bg-bg-panel px-6 py-3">
      <h1 className="font-mono text-base text-text-primary">RunoGraph</h1>
      <select
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded border border-border-hairline bg-bg-sunken px-2 py-1 font-mono text-sm text-text-primary focus:border-border-strong focus:outline-none"
      >
        {experiments.map((exp) => (
          <option key={exp.experiment_id} value={exp.experiment_id}>
            {exp.experiment_id} · {exp.run_count} runs
          </option>
        ))}
      </select>
    </header>
  );
}
