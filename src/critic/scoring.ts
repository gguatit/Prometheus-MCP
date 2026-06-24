import type {
  QualityDimension,
  DimensionScores,
  ScoreContribution,
  Finding,
  Evidence,
} from "../types/index.js";
import { QUALITY_DIMENSIONS } from "../types/index.js";

/**
 * ScoringEngine — deterministic, auditable weighted rubric. Each rule returns a
 * sub-score (0..1) per dimension; the engine aggregates into 0..100 per
 * dimension and a weighted aggregate across dimensions. Every contribution is
 * recorded in `justification[]` so any score can be reconstructed.
 *
 * LLM reasoning contributions are applied SEPARATELY by the CriticEngine (capped
 * ±llmReasoningCap, evidence-bound). This module is pure measurement.
 */

export interface DimensionResult {
  dimension: QualityDimension;
  score: number; // 0..100
  contributions: ScoreContribution[];
  findings: Finding[];
}

export interface ScoringInput {
  ruleResults: RuleResult[];
  dimensionWeights: Record<QualityDimension, number>;
}

export interface RuleResult {
  ruleId: string;
  dimension: QualityDimension;
  weight: number; // relative within dimension
  subScore: number; // 0..1
  findings: Finding[];
  evidence: string[]; // signal ids
  note: string;
}

export interface ScoringOutput {
  dimensionScores: DimensionScores;
  aggregateScore: number;
  contributions: ScoreContribution[];
  findings: Finding[];
  byDimension: DimensionResult[];
}

export function score(input: ScoringInput): ScoringOutput {
  const byDim = new Map<QualityDimension, RuleResult[]>();
  for (const r of input.ruleResults) {
    const arr = byDim.get(r.dimension) ?? [];
    arr.push(r);
    byDim.set(r.dimension, arr);
  }

  const contributions: ScoreContribution[] = [];
  const findings: Finding[] = [];
  const dimResults: DimensionResult[] = [];
  const dimScores = {} as DimensionScores;

  for (const dim of QUALITY_DIMENSIONS) {
    const results = byDim.get(dim) ?? [];
    const totalWeight = results.reduce((s, r) => s + r.weight, 0) || 1;
    let raw = 0;
    const dimContribs: ScoreContribution[] = [];
    const dimFindings: Finding[] = [];
    for (const r of results) {
      const contribution = (r.weight / totalWeight) * r.subScore * 100;
      raw += contribution;
      const delta = Math.round(contribution * 100) / 100;
      const contrib: ScoreContribution = {
        ruleId: r.ruleId,
        dimension: dim,
        delta,
        evidence: r.evidence,
        note: r.note,
      };
      dimContribs.push(contrib);
      contributions.push(contrib);
      dimFindings.push(...r.findings);
    }
    const score100 = Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;
    dimScores[dim] = score100;
    findings.push(...dimFindings);
    dimResults.push({ dimension: dim, score: score100, contributions: dimContribs, findings: dimFindings });
  }

  const weightSum = QUALITY_DIMENSIONS.reduce((s, d) => s + (input.dimensionWeights[d] ?? 0), 0) || 1;
  let aggregate = 0;
  for (const dim of QUALITY_DIMENSIONS) {
    aggregate += (input.dimensionWeights[dim] ?? 0) * dimScores[dim];
  }
  const aggregateScore = Math.round((aggregate / weightSum) * 100) / 100;

  return { dimensionScores: dimScores, aggregateScore, contributions, findings, byDimension: dimResults };
}

/** Apply an LLM reasoning adjustment to a dimension, capped, recording a contribution. */
export function applyReasoningAdjustment(
  base: ScoringOutput,
  dimension: QualityDimension,
  delta: number,
  cap: number,
  evidenceIds: string[],
  note: string,
): ScoringOutput {
  const capped = Math.max(-cap, Math.min(cap, delta));
  if (capped === 0) return base;
  const newScore = Math.max(0, Math.min(100, base.dimensionScores[dimension] + capped));
  const newDimScores = { ...base.dimensionScores, [dimension]: Math.round(newScore * 100) / 100 };
  const contrib: ScoreContribution = {
    ruleId: "llm-reasoning",
    dimension,
    delta: Math.round(capped * 100) / 100,
    evidence: evidenceIds,
    note: `LLM reasoning (capped ±${cap}): ${note}`,
  };
  // recompute aggregate
  const weightSum = QUALITY_DIMENSIONS.reduce((_, d) => _ + 1, 0); // not used; recompute below
  void weightSum;
  let aggregate = 0;
  // use equal weights fallback if not provided; aggregate recomputed externally by caller normally
  for (const d of QUALITY_DIMENSIONS) aggregate += newDimScores[d];
  const aggregateScore = Math.round((aggregate / QUALITY_DIMENSIONS.length) * 100) / 100;
  return {
    ...base,
    dimensionScores: newDimScores,
    contributions: [...base.contributions, contrib],
    aggregateScore,
  };
}

export { QUALITY_DIMENSIONS };
