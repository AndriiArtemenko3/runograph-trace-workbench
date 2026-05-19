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

export interface StageDecompCell {
  value: string;
  sign: EVSign;
  magnitude: EVMagnitude;
}

export interface StageDecompRow {
  stage: string;
  a: StageDecompCell;
  b: StageDecompCell;
  c: StageDecompCell;
  d: StageDecompCell;
}

export interface RecommendationBullet {
  text: string;
  tone: "neutral" | "accent";
}

export interface RecommendationPillContent {
  kind: "top-pick" | "runner-up";
  harnessId: string;
  ev: string;
  descriptor: string;
  bullets: RecommendationBullet[];
}

export interface Recommendation {
  topPick: RecommendationPillContent;
  runnerUp: RecommendationPillContent;
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
  stageDecomposition: StageDecompRow[];
  failureClasses: FailureClassRow[];
  recommendation: Recommendation;
}
