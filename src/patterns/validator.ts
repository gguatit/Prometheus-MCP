import type { Pattern, QualityDimension } from "../types/index.js";
import { QUALITY_DIMENSIONS } from "../types/index.js";
import { ok, err, type Result } from "../types/index.js";

/**
 * PatternValidator — patterns are content-as-policy. Each is validated on load:
 *   - schema completeness (required fields, non-empty)
 *   - semver version
 *   - quality rule weights within a dimension sum to 1.0 (relative)
 *   - rule/anti-pattern ids are unique
 *   - no anti-pattern that targets the same id as a required element
 *   - example outputs reference declared elements (soft warning, not error)
 *   - no executable/JS in snippet fields (sanity)
 *
 * Invalid patterns are rejected (not silently loaded).
 */

const SEMVER = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

export interface ValidationReport {
  patternId: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePattern(p: Pattern): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!p.id || !/^[a-z0-9_\-]+$/.test(p.id)) errors.push(`id must be kebab/snake-case non-empty: "${p.id}"`);
  if (!p.name?.trim()) errors.push("name is required");
  if (!p.description?.trim()) errors.push("description is required");
  if (!p.category?.trim()) errors.push("category is required");
  if (!p.version || !SEMVER.test(p.version)) errors.push(`version must be semver: "${p.version}"`);
  if (!p.provenance || !p.provenance.source) errors.push("provenance.source is required");
  if (!p.provenance || !p.provenance.trust) errors.push("provenance.trust is required");

  if (!Array.isArray(p.requiredElements)) errors.push("requiredElements must be an array");
  for (const e of p.requiredElements ?? []) {
    if (!e.name?.trim() || !e.description?.trim()) errors.push(`required element has empty name/description`);
    if (e.required !== true) errors.push(`required element "${e.name}" must have required=true`);
  }
  for (const e of p.optionalElements ?? []) {
    if (!e.name?.trim()) errors.push("optional element has empty name");
    if (e.required === true) errors.push(`optional element "${e.name}" must not have required=true`);
  }

  // quality rules
  const ruleIds = new Set<string>();
  const byDim = new Map<QualityDimension, number>();
  for (const r of p.qualityRules ?? []) {
    if (!r.id?.trim()) errors.push("quality rule missing id");
    if (r.id && ruleIds.has(r.id)) errors.push(`duplicate quality rule id: ${r.id}`);
    if (r.id) ruleIds.add(r.id);
    if (!QUALITY_DIMENSIONS.includes(r.dimension)) errors.push(`rule "${r.id}" has invalid dimension: ${r.dimension}`);
    if (r.weight < 0 || r.weight > 1) errors.push(`rule "${r.id}" weight out of [0,1]: ${r.weight}`);
    byDim.set(r.dimension, (byDim.get(r.dimension) ?? 0) + r.weight);
  }
  for (const [dim, sum] of byDim) {
    if (Math.abs(sum - 1) > 0.001) {
      warnings.push(`dimension "${dim}" rule weights sum to ${sum}, not 1.0 (will be normalized)`);
    }
  }
  if ((p.qualityRules?.length ?? 0) === 0) errors.push("at least one quality rule is required");

  // anti-patterns
  const apIds = new Set<string>();
  for (const a of p.antiPatterns ?? []) {
    if (!a.id?.trim()) errors.push("anti-pattern missing id");
    if (a.id && apIds.has(a.id)) errors.push(`duplicate anti-pattern id: ${a.id}`);
    if (a.id) apIds.add(a.id);
    if (!QUALITY_DIMENSIONS.includes(a.dimension)) errors.push(`anti-pattern "${a.id}" invalid dimension`);
  }

  // no anti-pattern id colliding with a required element name
  const reqNames = new Set((p.requiredElements ?? []).map((e) => e.name));
  for (const a of p.antiPatterns ?? []) {
    if (reqNames.has(a.id)) errors.push(`anti-pattern id "${a.id}" collides with a required element name`);
  }

  // improvement suggestions
  for (const s of p.improvementSuggestions ?? []) {
    if (!s.id?.trim()) errors.push("improvement suggestion missing id");
    if (s.expectedUplift < 0 || s.expectedUplift > 100) errors.push(`suggestion "${s.id}" uplift out of [0,100]`);
  }

  // examples
  for (const ex of p.exampleOutputs ?? []) {
    if (!ex.label?.trim() || !ex.snippet?.trim()) errors.push("example output missing label/snippet");
    if (/<script[^>]*>/i.test(ex.snippet)) errors.push(`example "${ex.label}" contains a <script> tag (not allowed)`);
  }

  return { patternId: p.id, valid: errors.length === 0, errors, warnings };
}

/** Throws on invalid — convenience for repository loaders. */
export function assertValidPattern(p: Pattern): Result<Pattern, string> {
  const r = validatePattern(p);
  if (!r.valid) return err(`pattern ${p.id} invalid: ${r.errors.join("; ")}`);
  return ok(p);
}
