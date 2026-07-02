import { serializePredicate } from "../../filters/predicate";
import type { Predicate } from "../../filters/predicate";

export interface QuickChip {
  label: string;
  /** Plain toggle chip: predicate added/removed verbatim. */
  pred?: Predicate;
  /** Merge chip: value toggled inside a single `column:in:` predicate so
   *  e.g. pass+fail chips compose to outcome:in:pass,fail. */
  mergeColumn?: string;
  mergeValue?: string;
}

interface QuickChipsProps {
  chips: QuickChip[];
  predicates: Predicate[];
  onChange: (preds: Predicate[]) => void;
}

function isChipActive(chip: QuickChip, preds: Predicate[]): boolean {
  if (chip.pred) {
    const key = serializePredicate(chip.pred);
    return preds.some((p) => serializePredicate(p) === key);
  }
  return preds.some(
    (p) =>
      p.column === chip.mergeColumn &&
      p.op === "in" &&
      p.values.includes(chip.mergeValue!),
  );
}

function toggle(chip: QuickChip, preds: Predicate[]): Predicate[] {
  if (chip.pred) {
    const key = serializePredicate(chip.pred);
    const without = preds.filter((p) => serializePredicate(p) !== key);
    return without.length < preds.length ? without : [...preds, chip.pred];
  }
  const column = chip.mergeColumn!;
  const value = chip.mergeValue!;
  const existing = preds.find((p) => p.column === column && p.op === "in");
  const others = preds.filter((p) => !(p.column === column && p.op === "in"));
  const values = existing ? [...existing.values] : [];
  const idx = values.indexOf(value);
  if (idx === -1) values.push(value);
  else values.splice(idx, 1);
  if (values.length === 0) return others;
  return [...others, { column, op: "in", values }];
}

/** One-click filter shortcuts. Chips are pure predicate constructors on the
 *  shared handlers — active iff their predicate/value is in filter state. */
export function QuickChips({ chips, predicates, onChange }: QuickChipsProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => {
        const active = isChipActive(chip, predicates);
        return (
          <button
            key={chip.label}
            onClick={() => onChange(toggle(chip, predicates))}
            className={
              active
                ? "rounded-full border border-accent-primary bg-bg-elevated px-2 py-0.5 font-mono text-xs text-text-primary"
                : "rounded-full border border-border-hairline px-2 py-0.5 font-mono text-xs text-text-secondary hover:text-text-primary"
            }
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
