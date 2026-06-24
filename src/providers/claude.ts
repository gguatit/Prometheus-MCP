import type { GenerationRequest, GenerationResponse } from "../types/index.js";
import type { IProvider } from "./types.js";
import { CAPS, emptyArtifact, estimateTokens } from "./types.js";
import type { ProviderConfig } from "../infrastructure/config.js";

/**
 * ClaudeProvider — Anthropic Messages API adapter. Distinct from the
 * OpenAI-compatible family (different request/response shape, header-based auth,
 * system as a top-level field). Capability-based like all providers.
 */
export class ClaudeProvider implements IProvider {
  readonly id = "claude" as const;
  readonly capabilities = CAPS.claude;

  constructor(private readonly cfg: ProviderConfig) {}

  async generate(req: GenerationRequest): Promise<GenerationResponse> {
    const key = this.cfg.apiKeyEnv ? process.env[this.cfg.apiKeyEnv] : undefined;
    if (!key) throw new Error(`provider claude requires ${this.cfg.apiKeyEnv ?? "ANTHROPIC_API_KEY"} in env`);
    const model = this.cfg.defaultModel ?? "claude-3-5-sonnet-20241022";
    const start = Date.now();

    const res = await fetch(`${this.cfg.baseURL ?? "https://api.anthropic.com/v1"}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.7,
        system: req.systemPrompt ?? "",
        messages: [{ role: "user", content: req.userPrompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`provider claude HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as AnthropicResponse;
    const content = (data.content ?? []).map((b) => b.text).join("");
    const promptTokens = data.usage?.input_tokens ?? estimateTokens(req.userPrompt);
    const completionTokens = data.usage?.output_tokens ?? estimateTokens(content);
    const costUsd =
      (this.cfg.costPer1kInputUsd ?? 0.003) * (promptTokens / 1000) +
      (this.cfg.costPer1kOutputUsd ?? 0.015) * (completionTokens / 1000);

    return {
      artifact: emptyArtifact(req.expectedKind, "claude", 0, content),
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, costUsd, latencyMs: Date.now() - start },
      providerId: "claude",
      model,
      finishReason: data.stop_reason ?? "end_turn",
    };
  }
}

interface AnthropicResponse {
  content?: { text: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}
