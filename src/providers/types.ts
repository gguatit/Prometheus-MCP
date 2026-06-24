import type {
  Capabilities,
  GenerationRequest,
  GenerationResponse,
  ProviderId,
  Artifact,
  ArtifactKind,
} from "../types/index.js";
import { newId } from "../infrastructure/telemetry.js";

/**
 * IProvider — capability-based provider abstraction. Adding a vendor means:
 *   1. declare Capabilities
 *   2. implement generate(req)
 * The router matches task-required capabilities to providers; no orchestrator
 * code changes per vendor.
 */

export interface IProvider {
  readonly id: ProviderId;
  readonly capabilities: Capabilities;
  generate(req: GenerationRequest): Promise<GenerationResponse>;
}

export const CAPS: Record<ProviderId, Capabilities> = {
  stub: { streaming: false, toolUse: false, structuredOutput: true, vision: false, contextWindow: 8000, supportsSystemPrompt: true },
  openai: { streaming: true, toolUse: true, structuredOutput: true, vision: true, contextWindow: 128000, supportsSystemPrompt: true },
  deepseek: { streaming: true, toolUse: true, structuredOutput: false, vision: false, contextWindow: 64000, supportsSystemPrompt: true },
  minimax: { streaming: true, toolUse: false, structuredOutput: false, vision: false, contextWindow: 245000, supportsSystemPrompt: true },
  qwen: { streaming: true, toolUse: true, structuredOutput: true, vision: true, contextWindow: 128000, supportsSystemPrompt: true },
  glm: { streaming: true, toolUse: true, structuredOutput: true, vision: true, contextWindow: 128000, supportsSystemPrompt: true },
  claude: { streaming: true, toolUse: true, structuredOutput: false, vision: true, contextWindow: 200000, supportsSystemPrompt: true },
};

export function emptyArtifact(kind: ArtifactKind, providerId: ProviderId, iteration: number, content: string, label?: string): Artifact {
  return {
    id: newId("art"),
    kind,
    content,
    label,
    generatedAt: new Date().toISOString(),
    providerId,
    iteration,
  };
}

/** Estimate tokens with a rough heuristic (4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
