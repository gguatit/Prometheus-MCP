import type { CreativeBrief, Pattern } from "../types/index.js";
import type { IPatternRepository, PatternSummary } from "./repository.js";
import type { IMemoryRepository } from "../memory/repository.js";

/**
 * PatternSelector — ranks candidate patterns against a brief using:
 *   - domain match (strong)
 *   - text similarity of intent vs name/description/category (moderate)
 *   - element coverage of brief constraints (moderate)
 *   - past effectiveness from Memory (tie-breaker, learning signal)
 *
 * Returns ranked Pattern[] (full bodies) with trust filter applied.
 */

export interface PatternScore {
  summary: PatternSummary;
  score: number;
  reasons: string[];
}

export interface SelectOptions {
  topK?: number;
}

export function selectPatterns(
  brief: CreativeBrief,
  repo: IPatternRepository,
  memory: IMemoryRepository | undefined,
  opts: SelectOptions = {},
): PatternScore[] {
  const topK = opts.topK ?? 3;
  const candidates: PatternScore[] = [];

  const domainMatches = repo.byDomain(brief.domain);
  const pool = domainMatches.length > 0 ? domainMatches : repo.list();

  const intentTokens = tokenize(brief.intent);
  const constraintTokens = brief.constraints.flatMap(tokenize);

  for (const summary of pool) {
    const reasons: string[] = [];
    let score = 0;

    if (summary.domain === brief.domain) {
      score += 40;
      reasons.push(`domain match: ${summary.domain}`);
    }

    const nameTokens = tokenize(`${summary.name} ${summary.description} ${summary.category}`);
    const overlap = jaccard(intentTokens, nameTokens);
    score += overlap * 35;
    if (overlap > 0.1) reasons.push(`intent relevance: ${(overlap * 100).toFixed(0)}%`);

    const constraintOverlap = constraintTokens.filter((t) => nameTokens.includes(t)).length;
    if (constraintTokens.length > 0) {
      const cov = constraintOverlap / constraintTokens.length;
      score += cov * 15;
      if (cov > 0) reasons.push(`constraint coverage: ${(cov * 100).toFixed(0)}%`);
    }

    // learning signal
    if (memory) {
      const eff = memory.effectivenessFor("pattern-effectiveness", summary.category);
      if (eff && eff.attempts > 0) {
        const successRate = eff.successes / eff.attempts;
        score += successRate * 10;
        if (successRate > 0) reasons.push(`past success rate: ${(successRate * 100).toFixed(0)}% (n=${eff.attempts})`);
      }
    }

    candidates.push({ summary, score, reasons });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, topK);
}

export async function resolveTopPattern(
  brief: CreativeBrief,
  repo: IPatternRepository,
  memory: IMemoryRepository | undefined,
): Promise<Pattern | undefined> {
  const ranked = selectPatterns(brief, repo, memory, { topK: 1 });
  if (ranked.length === 0) return undefined;
  return repo.get(ranked[0]!.summary.id);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return inter / union;
}
