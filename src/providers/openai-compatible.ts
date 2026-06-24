import type {
  GenerationRequest,
  GenerationResponse,
  ProviderId,
} from "../types/index.js";
import type { IProvider } from "./types.js";
import { CAPS, emptyArtifact, estimateTokens } from "./types.js";
import type { ProviderConfig } from "../infrastructure/config.js";

/**
 * OpenAICompatibleProvider — ONE adapter serves OpenAI, DeepSeek, MiniMax,
 * Qwen, and GLM (all expose the OpenAI-compatible Chat Completions endpoint).
 * Vendor-specific differences are capability flags + the baseURL/model in
 * ProviderConfig, not separate classes. This is the core anti-lock-in design.
 *
 * Uses the global fetch (Node 20+). API key is read from env at call time,
 * never stored on the instance, never logged.
 */
export class OpenAICompatibleProvider implements IProvider {
  readonly capabilities;

  constructor(
    readonly id: ProviderId,
    private readonly cfg: ProviderConfig,
  ) {
    this.capabilities = CAPS[id];
  }

  async generate(req: GenerationRequest): Promise<GenerationResponse> {
    const key = this.cfg.apiKeyEnv ? process.env[this.cfg.apiKeyEnv] : undefined;
    if (!key) {
      throw new Error(`provider ${this.id} requires ${this.cfg.apiKeyEnv ?? "an API key"} in env`);
    }
    if (!this.cfg.baseURL) throw new Error(`provider ${this.id} missing baseURL`);

    const model = this.cfg.defaultModel ?? "gpt-4o";
    const start = Date.now();
    const messages: { role: string; content: string }[] = [];
    if (req.systemPrompt && this.capabilities.supportsSystemPrompt) {
      messages.push({ role: "system", content: req.systemPrompt });
    }
    messages.push({ role: "user", content: req.userPrompt });

    const res = await fetch(`${this.cfg.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.7,
        stream: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`provider ${this.id} HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as OpenAIChatResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage;
    const promptTokens = usage?.prompt_tokens ?? estimateTokens(req.userPrompt);
    const completionTokens = usage?.completion_tokens ?? estimateTokens(content);

    const costUsd =
      (this.cfg.costPer1kInputUsd ?? 0) * (promptTokens / 1000) +
      (this.cfg.costPer1kOutputUsd ?? 0) * (completionTokens / 1000);

    return {
      artifact: emptyArtifact(req.expectedKind, this.id, 0, content),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUsd,
        latencyMs: Date.now() - start,
      },
      providerId: this.id,
      model,
      finishReason: data.choices?.[0]?.finish_reason ?? "stop",
    };
  }
}

interface OpenAIChatResponse {
  choices?: { message?: { content: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
