/**
 * TypeScript mirror of the Pydantic models in
 * backend/runograph_backend/api/v1/solver_grid.py.
 *
 * Keep in sync: when a field is added on either side, update the other before
 * shipping. The backend serialises with camelCase aliases (`populate_by_name`
 * + `Field(alias=...)`), so this file uses camelCase field names.
 */

import type { EVSign, EVMagnitude } from "../components/EVCell";

export type HarnessId = "A" | "B" | "C" | "D";

export interface MatrixCell {
  label: string;
  value: string;
  sign: EVSign;
  magnitude: EVMagnitude;
}

export interface Harness {
  id: HarnessId;
  name: string;
  ev: string;
  evSign: EVSign;
  evMagnitude: EVMagnitude;
  ci: string;
  winner: boolean;
  cells: MatrixCell[];
}

export interface StageRow {
  stage: string;
  ev: string;
  selected: boolean;
}

export interface FailureClassRow {
  failureClass: string;
  a: string;
  b: string;
  c: string;
  d: string;
}

export interface SolverGridResponse {
  taskClass: string;
  simsPerHarness: number;
  iterComplete: number;
  iterTotal: number;
  weightProfile: string;
  harnesses: Harness[];
  stages: StageRow[];
  failureClasses: FailureClassRow[];
}
