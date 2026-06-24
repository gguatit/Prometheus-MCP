import type {
  GenerationRequest,
  ProviderId,
  ProviderHint,
  Capabilities,
} from "../types/index.js";
import type { IProvider } from "./types.js";

/**
 * ProviderRouter — selects a provider by matching task-required capabilities +
 * hints + cost preference. Stateless per request. Adding a provider = register
 * it; router logic unchanged.
 */

export interface RouterDeps {
  defaultProvider: ProviderId;
  costRanking?: ProviderId[]; // cheapest first
}

export class ProviderRouter {
  constructor(
    private readonly providers: Map<ProviderId, IProvider>,
    private readonly deps: RouterDeps,
  ) {}

  register(p: IProvider): void {
    this.providers.set(p.id, p);
  }

  available(): ProviderId[] {
    return [...this.providers.keys()];
  }

  get(id: ProviderId): IProvider | undefined {
    return this.providers.get(id);
  }

  /** Select by hints + required capabilities; fall back to default. */
  select(hints: ProviderHint[] = [], requireVision = false, requireStreaming = false, requireStructured = false): IProvider {
    const requireV = requireVision || hints.some((h) => h.requireVision);
    const requireS = requireStreaming || hints.some((h) => h.requireStreaming);
    const requireSt = requireStructured || hints.some((h) => h.requireStructuredOutput);
    const preferLowCost = hints.some((h) => h.preferLowCost);

    // explicit hint — verify capability requirements before accepting
    const explicit = hints.find((h) => h.providerId);
    if (explicit?.providerId) {
      const p = this.providers.get(explicit.providerId);
      if (p && meets(p.capabilities, requireV, requireS, requireSt)) return p;
    }

    const candidates = [...this.providers.values()].filter((p) => meets(p.capabilities, requireV, requireS, requireSt));

    if (candidates.length === 0) {
      const fallback = this.providers.get(this.deps.defaultProvider);
      if (!fallback) throw new Error("no provider available and no default configured");
      return fallback;
    }

    if (preferLowCost && this.deps.costRanking) {
      for (const id of this.deps.costRanking) {
        const c = candidates.find((p) => p.id === id);
        if (c) return c;
      }
    }

    // prefer largest context among matched as a stable default
    candidates.sort((a, b) => b.capabilities.contextWindow - a.capabilities.contextWindow);
    return candidates[0]!;
  }

  selectFor(req: GenerationRequest): IProvider {
    return this.select([], false, false, false);
  }
}

function meets(caps: Capabilities, vision: boolean, streaming: boolean, structured: boolean): boolean {
  if (vision && !caps.vision) return false;
  if (streaming && !caps.streaming) return false;
  if (structured && !caps.structuredOutput) return false;
  return true;
}
