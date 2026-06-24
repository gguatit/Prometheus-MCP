import type {
  Artifact,
  Critique,
  Evidence,
  Finding,
  Pattern,
  QualityDimension,
  Suggestion,
  RecommendedNextStep,
  ScoreContribution,
} from "../types/index.js";
import { QUALITY_DIMENSIONS } from "../types/index.js";
import { collectEvidence } from "./evidence.js";
import { runRules } from "./rules.js";
import { score, applyReasoningAdjustment, type ScoringOutput } from "./scoring.js";
import type { IProvider } from "../providers/types.js";
import type { RuntimeConfig } from "../infrastructure/config.js";
import { newId } from "../infrastructure/telemetry.js";

/**
 * CriticEngine — two-phase evaluation.
 *   Phase 1 (deterministic): EvidenceCollector + rule engine + scoring.
 *   Phase 2 (optional, capped): LLM reasoning augments qualitative dimensions,
 *   bound by evidence ids, ±llmReasoningCap per dimension.
 *
 * Output: a full Critique with strengths/weaknesses/missing/issues/opportunities,
 * prioritized suggestions with expected uplift, and the complete justification
 * tree. Critic emits recommendedNextStep so the LoopController can route.
 */

export const CRITIC_VERSION = "0.1.0";

export interface CriticOptions {
  pattern?: Pattern;
  sessionId: string;
  reasoningProvider?: IProvider; // optional LLM for qualitative reasoning
}

export class CriticEngine {
  constructor(private readonly config: RuntimeConfig) {}

  async critique(artifact: Artifact, opts: CriticOptions): Promise<Critique> {
    const evidence = collectEvidence(artifact, { pattern: opts.pattern });
    const ruleResults = runRules({ artifact, evidence, pattern: opts.pattern });
    const base = score({ ruleResults, dimensionWeights: this.config.dimensionWeights });

    let final: ScoringOutput = base;
    let reasoningUsed = false;

    if (this.config.enableLLMReasoning && opts.reasoningProvider && opts.reasoningProvider.id !== "stub") {
      const adjustments = await this.reason(opts.reasoningProvider, artifact, evidence, opts.pattern);
      if (adjustments.length > 0) {
        reasoningUsed = true;
        for (const adj of adjustments) {
          final = applyReasoningAdjustment(final, adj.dimension, adj.delta, this.config.llmReasoningCap, adj.evidenceIds, adj.note);
        }
      }
    }

    const findings = mergeFindings(final.findings);
    const suggestions = buildSuggestions(findings, opts.pattern);
    const expectedUpliftIfApplied = round(suggestions.reduce((s, x) => s + x.expectedUplift, 0) * 0.6);

    return {
      artifactId: artifact.id,
      sessionId: opts.sessionId,
      criticVersion: CRITIC_VERSION,
      dimensionScores: final.dimensionScores,
      aggregateScore: final.aggregateScore,
      findings,
      suggestions,
      justification: final.contributions,
      expectedUpliftIfApplied,
      recommendedNextStep: decideNextStep(final.aggregateScore, this.config.defaultTargetScore, findings, evidence, opts.pattern),
      reasoningUsed,
      createdAt: new Date().toISOString(),
    };
  }

  evidenceOnly(artifact: Artifact, pattern?: Pattern): Evidence {
    return collectEvidence(artifact, { pattern });
  }

  private async reason(provider: IProvider, artifact: Artifact, evidence: Evidence, pattern?: Pattern): Promise<ReasoningAdjustment[]> {
    // Ask a reasoning-capable model for qualitative adjustments, but constrain it
    // to cite evidence and stay within caps. This is the bounded LLM pass.
    const dims: QualityDimension[] = ["visual-impact", "creative-originality", "modern-design-practices", "user-experience"];
    const evidenceSummary = evidence.signals.map((s) => `${s.id}: ${s.label}=${s.value.toFixed(2)} (${s.detail})`).join("\n");
    const systemPrompt = `You are a senior creative-director evaluator. For each dimension, output a signed integer delta (between -${this.config.llmReasoningCap} and +${this.config.llmReasoningCap}) that adjusts a deterministic baseline score, based ONLY on the evidence provided. You MUST cite evidence ids. Respond as JSON: {"adjustments":[{"dimension":...,"delta":...,"evidenceIds":[...],"note":...}]}. Do not invent evidence.`;
    const userPrompt = `Artifact (kind=${artifact.kind}):\n${artifact.content.slice(0, 6000)}\n\nEvidence:\n${evidenceSummary}\n\nPattern: ${pattern?.name ?? "none"}\nDimensions to assess: ${dims.join(", ")}`;

    try {
      const res = await provider.generate({
        providerId: provider.id,
        systemPrompt,
        userPrompt,
        expectedKind: "json",
        maxTokens: 800,
        temperature: 0.2,
        patternId: pattern?.id,
      });
      return parseAdjustments(res.artifact.content, this.config.llmReasoningCap);
    } catch {
      return []; // reasoning is best-effort; never fail the critique on it
    }
  }
}

interface ReasoningAdjustment {
  dimension: QualityDimension;
  delta: number;
  evidenceIds: string[];
  note: string;
}

function parseAdjustments(raw: string, cap: number): ReasoningAdjustment[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const obj = JSON.parse(match[0]) as { adjustments?: Array<{ dimension: string; delta: number; evidenceIds?: string[]; note?: string }> };
    const out: ReasoningAdjustment[] = [];
    for (const a of obj.adjustments ?? []) {
      if (!QUALITY_DIMENSIONS.includes(a.dimension as QualityDimension)) continue;
      const delta = Math.max(-cap, Math.min(cap, Math.round(a.delta)));
      if (delta === 0) continue;
      out.push({ dimension: a.dimension as QualityDimension, delta, evidenceIds: a.evidenceIds ?? [], note: a.note ?? "" });
    }
    return out;
  } catch {
    return [];
  }
}

function mergeFindings(findings: Finding[]): Finding[] {
  // dedupe by id, keep order
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

function buildSuggestions(findings: Finding[], pattern?: Pattern): Suggestion[] {
  const actionable = findings.filter((f) => f.kind !== "strength" && (f.severity === "major" || f.severity === "critical" || f.kind === "missing" || f.kind === "opportunity"));
  const suggestions: Suggestion[] = actionable.map((f, i) => ({
    id: `sug-${i + 1}`,
    dimension: f.dimension,
    priority: severityToPriority(f.severity),
    description: f.message,
    expectedUplift: severityToUplift(f.severity),
    suggestedFix: f.suggestedFix,
  }));
  // fold in pattern improvement suggestions
  if (pattern) {
    for (const is of pattern.improvementSuggestions) {
      suggestions.push({ id: is.id, dimension: is.dimension, priority: 3, description: is.description, expectedUplift: is.expectedUplift });
    }
  }
  suggestions.sort((a, b) => a.priority - b.priority || b.expectedUplift - a.expectedUplift);
  return suggestions;
}

function severityToPriority(s: Finding["severity"]): number {
  return s === "critical" ? 1 : s === "major" ? 2 : s === "minor" ? 3 : 4;
}
function severityToUplift(s: Finding["severity"]): number {
  return s === "critical" ? 18 : s === "major" ? 10 : s === "minor" ? 5 : 2;
}

function decideNextStep(
  aggregate: number,
  target: number,
  findings: Finding[],
  evidence: Evidence,
  pattern: Pattern | undefined,
): RecommendedNextStep {
  if (aggregate >= target) return "finalize";
  if (!evidence.valid) return "regenerate"; // structural problems -> full regen
  const missing = findings.filter((f) => f.kind === "missing");
  if (missing.length > 2 && pattern) return "reselect"; // wrong pattern
  const hasResearchGap = findings.some((f) => f.kind === "tech-issue" && f.message.toLowerCase().includes("unknown"));
  if (hasResearchGap) return "research";
  return "improve";
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export type { ScoreContribution };
export { newId };
