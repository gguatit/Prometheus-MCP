import type { CreativeBrief, Domain, TerminationPolicy, ProviderHint, Artifact } from "../types/index.js";
import { newId } from "../infrastructure/telemetry.js";
import type { RuntimeConfig } from "../infrastructure/config.js";

/**
 * Planner — decomposes a raw user intent into a CreativeBrief with a budget,
 * target score, and provider hints. Also detects the domain from intent text.
 * Kept deliberately simple: the intelligence is in the loop, not the planner.
 */

export interface PlanInput {
  intent: string;
  domain?: Domain;
  targetScore?: number;
  maxIterations?: number;
  costBudgetUsd?: number;
  provider?: string;
  seedArtifact?: { kind: Artifact["kind"]; content: string; label?: string };
  constraints?: string[];
}

const DOMAIN_KEYWORDS: { domain: Domain; words: string[] }[] = [
  { domain: "three-js", words: ["three.js", "threejs", "webgl scene", "3d scene"] },
  { domain: "react-three-fiber", words: ["react three fiber", "r3f", "<canvas>", "useframe"] },
  { domain: "vfx", words: ["vfx", "particle", "shader", "fireball", "lightning", "magic circle", "spell"] },
  { domain: "ui-design", words: ["dashboard", "control panel", "hud", "interface", "ui", "glassmorphism"] },
  { domain: "web-design", words: ["landing page", "hero section", "website", "web page"] },
  { domain: "ux-design", words: ["user flow", "ux", "interaction", "user experience"] },
  { domain: "frontend-animation", words: ["animation", "motion", "gsap", "framer", "transition"] },
  { domain: "interactive-experience", words: ["interactive", "experience", "scroll", "parallax"] },
  { domain: "game-development", words: ["game", "skill effect", "engine", "playable"] },
  { domain: "creative-coding", words: ["creative coding", "generative", "canvas", "experiment"] },
];

export function detectDomain(intent: string): Domain {
  const lower = intent.toLowerCase();
  for (const { domain, words } of DOMAIN_KEYWORDS) {
    if (words.some((w) => lower.includes(w))) return domain;
  }
  return "creative-coding";
}

export function makeBrief(input: PlanInput, config: RuntimeConfig): CreativeBrief {
  const domain = input.domain ?? detectDomain(input.intent);
  const targetScore = input.targetScore ?? config.defaultTargetScore;
  const maxIterations = input.maxIterations ?? config.defaultMaxIterations;
  const hints: ProviderHint[] = [];
  if (input.provider) hints.push({ providerId: input.provider as ProviderHint["providerId"] });

  return {
    id: newId("brief"),
    intent: input.intent,
    domain,
    constraints: input.constraints ?? [],
    targetScore,
    maxIterations,
    costBudgetUsd: input.costBudgetUsd ?? config.defaultMaxCostUsd,
    providerHints: hints,
    seedArtifact: input.seedArtifact
      ? { id: newId("art"), kind: input.seedArtifact.kind, content: input.seedArtifact.content, label: input.seedArtifact.label, generatedAt: new Date().toISOString(), providerId: "stub", iteration: 0 }
      : undefined,
  };
}

export function terminationPolicy(brief: CreativeBrief, config: RuntimeConfig): TerminationPolicy {
  return {
    targetScore: brief.targetScore,
    maxIterations: brief.maxIterations,
    maxCostUsd: brief.costBudgetUsd,
    maxWallClockMs: config.defaultMaxWallClockMs,
    minDeltaImprovement: config.minDeltaImprovement,
    maxFlatIterations: config.maxFlatIterations,
  };
}
