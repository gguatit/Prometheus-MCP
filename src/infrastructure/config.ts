import type { ProviderId, QualityDimension } from "../types/index.js";
import { QUALITY_DIMENSIONS } from "../types/index.js";

/**
 * Layered configuration: defaults → file (roadmap) → env → CLI. Validated and
 * normalized. Secrets live only here and are never emitted by telemetry
 * (SecretRedactor enforces).
 */

export interface ProviderConfig {
  id: ProviderId;
  enabled: boolean;
  baseURL?: string;
  apiKeyEnv?: string; // name of env var, never the key itself
  defaultModel?: string;
  costPer1kInputUsd?: number;
  costPer1kOutputUsd?: number;
}

export interface RuntimeConfig {
  version: string;
  patternsDir: string;
  historyDir: string;
  memoryDir: string;
  defaultTargetScore: number;
  defaultMaxIterations: number;
  defaultMaxCostUsd?: number;
  defaultMaxWallClockMs?: number;
  minDeltaImprovement: number;
  maxFlatIterations: number;
  dimensionWeights: Record<QualityDimension, number>;
  allowCommunityPatternsInCritic: boolean;
  llmReasoningCap: number; // ±N per dimension
  maxArtifactBytes: number;
  enableLLMReasoning: boolean;
  providers: ProviderConfig[];
  defaultProvider: ProviderId;
}

const DEFAULT_WEIGHTS: Record<QualityDimension, number> = {
  "visual-impact": 0.08,
  "design-consistency": 0.07,
  readability: 0.06,
  "animation-quality": 0.06,
  "technical-quality": 0.08,
  accessibility: 0.08,
  responsiveness: 0.07,
  performance: 0.07,
  "code-maintainability": 0.06,
  "code-quality": 0.06,
  "user-experience": 0.07,
  "creative-originality": 0.06,
  "modern-design-practices": 0.05,
  "industry-best-practices": 0.03,
  "graphics-quality": 0.06,
  "game-feel": 0.04,
};

export function defaultConfig(rootDir: string): RuntimeConfig {
  return {
    version: "0.1.0",
    patternsDir: `${rootDir}/patterns`,
    historyDir: `${rootDir}/.data/history`,
    memoryDir: `${rootDir}/.data/memory`,
    defaultTargetScore: 82,
    defaultMaxIterations: 3,
    defaultMaxCostUsd: 0.5,
    defaultMaxWallClockMs: 120_000,
    minDeltaImprovement: 3,
    maxFlatIterations: 2,
    dimensionWeights: { ...DEFAULT_WEIGHTS },
    allowCommunityPatternsInCritic: false,
    llmReasoningCap: 15,
    maxArtifactBytes: 256_000,
    enableLLMReasoning: true,
    defaultProvider: "stub",
    providers: [
      { id: "stub", enabled: true },
      { id: "openai", enabled: false, apiKeyEnv: "OPENAI_API_KEY", baseURL: "https://api.openai.com/v1", defaultModel: "gpt-4o", costPer1kInputUsd: 0.005, costPer1kOutputUsd: 0.015 },
      { id: "deepseek", enabled: false, apiKeyEnv: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", costPer1kInputUsd: 0.00014, costPer1kOutputUsd: 0.00028 },
      { id: "minimax", enabled: false, apiKeyEnv: "MINIMAX_API_KEY", baseURL: "https://api.minimax.chat/v1", defaultModel: "abab6.5-chat" },
      { id: "qwen", enabled: false, apiKeyEnv: "DASHSCOPE_API_KEY", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus" },
      { id: "glm", enabled: false, apiKeyEnv: "GLM_API_KEY", baseURL: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4" },
      { id: "claude", enabled: false, apiKeyEnv: "ANTHROPIC_API_KEY", baseURL: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-sonnet-20241022", costPer1kInputUsd: 0.003, costPer1kOutputUsd: 0.015 },
    ],
  };
}

/** Override config from environment variables. Returns a new config object. */
export function applyEnv(config: RuntimeConfig, env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const next: RuntimeConfig = { ...config, providers: config.providers.map((p) => ({ ...p })), dimensionWeights: { ...config.dimensionWeights } };

  if (env.PROMETHEUS_TARGET_SCORE) {
    const n = Number(env.PROMETHEUS_TARGET_SCORE);
    if (!Number.isNaN(n)) next.defaultTargetScore = n;
  }
  if (env.PROMETHEUS_MAX_ITERATIONS) {
    const n = Number(env.PROMETHEUS_MAX_ITERATIONS);
    if (Number.isInteger(n) && n > 0) next.defaultMaxIterations = n;
  }
  if (env.PROMETHEUS_MAX_COST_USD) {
    const n = Number(env.PROMETHEUS_MAX_COST_USD);
    if (!Number.isNaN(n)) next.defaultMaxCostUsd = n;
  }
  if (env.PROMETHEUS_DEFAULT_PROVIDER) {
    next.defaultProvider = env.PROMETHEUS_DEFAULT_PROVIDER as ProviderId;
  }
  if (env.PROMETHEUS_ENABLE_LLM_REASONING === "false") {
    next.enableLLMReasoning = false;
  }
  if (env.PROMETHEUS_ALLOW_COMMUNITY_PATTERNS === "true") {
    next.allowCommunityPatternsInCritic = true;
  }

  // Enable providers whose key env var is present.
  for (const p of next.providers) {
    if (p.apiKeyEnv && env[p.apiKeyEnv]) p.enabled = true;
  }
  return next;
}

/** Validate a config object. Throws on invalid. Returns the normalized config. */
export function validateConfig(config: RuntimeConfig): RuntimeConfig {
  if (config.defaultTargetScore < 0 || config.defaultTargetScore > 100) {
    throw new Error(`config.defaultTargetScore out of range: ${config.defaultTargetScore}`);
  }
  if (config.defaultMaxIterations < 1) {
    throw new Error("config.defaultMaxIterations must be >= 1");
  }
  if (config.llmReasoningCap < 0 || config.llmReasoningCap > 25) {
    throw new Error("config.llmReasoningCap must be in [0,25]");
  }
  const weightSum = QUALITY_DIMENSIONS.reduce((s, d) => s + (config.dimensionWeights[d] ?? 0), 0);
  if (Math.abs(weightSum - 1) > 0.001) {
    throw new Error(`dimension weights must sum to 1.0, got ${weightSum}`);
  }
  return config;
}
