import type {
  CreativeBrief,
  Session,
  Artifact,
  Critique,
  GenerationRequest,
  ImprovementPlan,
  RevisionPrompt,
  Evidence,
} from "../types/index.js";
import type { RuntimeConfig } from "../infrastructure/config.js";
import { Tracer, type TelemetrySink } from "../infrastructure/telemetry.js";
import type { IPatternRepository } from "../patterns/repository.js";
import { resolveTopPattern } from "../patterns/selector.js";
import { KnowledgeCollectorService } from "../knowledge/collector.js";
import { CriticEngine } from "../critic/engine.js";
import { ImprovementEngine } from "../improver/engine.js";
import { ProviderRouter } from "../providers/router.js";
import type { IProvider } from "../providers/types.js";
import type { IHistoryRepository, IMemoryRepository } from "../memory/repository.js";
import { newSession, newIteration, shouldTerminate, nextRoute, updateFlatCount, finalizeSession, type LoopContext } from "./loop.js";
import { terminationPolicy } from "./planner.js";

/**
 * Orchestrator — the conductor. It owns the state machine transitions and
 * delegates work to the modules. No domain logic here; just sequencing +
 * telemetry spans + budget accounting. This is the only place that knows the
 * full flow, which keeps every module independently testable.
 */
export class Orchestrator {
  private readonly tracer: Tracer;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly patterns: IPatternRepository,
    private readonly knowledge: KnowledgeCollectorService,
    private readonly critic: CriticEngine,
    private readonly improver: ImprovementEngine,
    private readonly router: ProviderRouter,
    private readonly history: IHistoryRepository,
    private readonly memory: IMemoryRepository,
    sink: TelemetrySink,
  ) {
    this.tracer = new Tracer(sink);
  }

  async run(brief: CreativeBrief): Promise<Session> {
    const session = newSession(brief);
    const policy = terminationPolicy(brief, this.config);
    const startedWallMs = Date.now();
    let accumulatedCostUsd = 0;
    let flatIterations = 0;
    let pattern = await resolveTopPattern(brief, this.patterns, this.memory);
    let knowledgeData = "";
    let lastCritique: Critique | undefined;
    let lastArtifact: Artifact | undefined;
    let next: import("../types/index.js").LoopState = "collect";
    let pendingRevision: RevisionPrompt | undefined;
    let pendingPlan: ImprovementPlan | undefined;
    void pendingPlan;

    const span = this.tracer.start("orchestrator.run", { sessionId: session.id, briefId: brief.id });

    try {
      // SAFETY: bounded by policy; never infinite. The guard counts state-machine
      // transitions (not improvement iterations). Each cycle is ~7 transitions
      // (collect→enhance→generate→evidence→critique→improve→decide); research/reselect
      // detours add a few more. Real termination is governed by shouldTerminate at
      // each 'decide' step; this is the runaway safety net only.
      const guardBound = policy.maxIterations * 8 + 20;
      for (let guard = 0; guard < guardBound; guard++) {
        switch (next) {
          case "collect": {
            const k = await this.knowledge.collect(brief);
            knowledgeData = k.dataBlock;
            if (pattern) next = "enhance";
            else next = "select";
            break;
          }
          case "select": {
            pattern = await resolveTopPattern(brief, this.patterns, this.memory);
            next = pattern ? "enhance" : "generate";
            break;
          }
          case "enhance": {
            next = "generate";
            break;
          }
          case "generate": {
            const provider = this.router.select(brief.providerHints ?? []);
            session.providerUsed = provider.id;
            if (pattern && !session.patternIds.includes(pattern.id)) session.patternIds.push(pattern.id);

            const req = this.buildRequest(brief, provider.id, pattern, knowledgeData, lastCritique, session.iterations.length, pendingRevision);
            const gen = await this.callProvider(provider, req, session);
            lastArtifact = gen.artifact;
            next = "evidence";
            break;
          }
          case "evidence": {
            next = "critique";
            break;
          }
          case "critique": {
            if (!lastArtifact) { next = "finalize"; break; }
            const reasoningProvider = this.reasoningProvider();
            lastCritique = await this.critic.critique(lastArtifact, { pattern, sessionId: session.id, reasoningProvider });
            flatIterations = updateFlatCount(
              { brief, policy, session, iteration: newIteration(session.iterations.length), lastCritique, flatIterations, startedWallMs, accumulatedCostUsd, state: "critique" } as LoopContext,
              lastCritique.aggregateScore,
            );
            // record iteration
            const it = newIteration(session.iterations.length);
            it.artifact = lastArtifact;
            it.critique = lastCritique;
            it.providerId = session.providerUsed;
            it.tokens = lastArtifact.metadata?.tokens as number | undefined ?? 0;
            it.costUsd = (lastArtifact.metadata?.costUsd as number | undefined) ?? 0;
            it.deltaScore = session.iterations.length > 0 ? lastCritique.aggregateScore - (session.iterations[session.iterations.length - 1]!.critique?.aggregateScore ?? 0) : undefined;
            session.iterations.push(it);
            next = "improve";
            break;
          }
          case "improve": {
            if (!lastArtifact || !lastCritique) { next = "finalize"; break; }
            const { plan, revision } = await this.improver.improve(lastArtifact, lastCritique, { pattern, memory: this.memory });
            pendingRevision = revision;
            pendingPlan = plan;
            next = "decide";
            break;
          }
          case "decide": {
            const ctx: LoopContext = { brief, policy, session, iteration: session.iterations[session.iterations.length - 1] ?? newIteration(0), lastCritique, flatIterations, startedWallMs, accumulatedCostUsd, state: "decide" };
            const term = shouldTerminate(ctx);
            if (term.terminate) {
              session.terminationReason = term.reason;
              next = "finalize";
              break;
            }
            if (!lastCritique) { next = "finalize"; break; }
            next = nextRoute(lastCritique.recommendedNextStep);
            // for regenerate/improve we already have a revision; for research/reselect we loop back
            break;
          }
          case "finalize": {
            finalizeSession(session, session.terminationReason ?? "completed", lastArtifact, lastCritique);
            await this.history.save(session);
            this.recordLearning(session, pattern?.category);
            span.setAttribute("finalScore", session.finalScore ?? 0);
            span.setAttribute("iterations", session.iterations.length);
            span.end();
            return session;
          }
        }
      }
      // guard fallback
      finalizeSession(session, "guard rail terminated loop", lastArtifact, lastCritique);
      await this.history.save(session);
      span.end();
      return session;
    } catch (e) {
      session.status = "error";
      session.terminationReason = (e as Error).message;
      session.endedAt = new Date().toISOString();
      span.end("error");
      try { await this.history.save(session); } catch { /* best effort */ }
      throw e;
    }
  }

  private reasoningProvider(): IProvider | undefined {
    if (!this.config.enableLLMReasoning) return undefined;
    // use any non-stub, reasoning-capable provider that is available
    for (const id of this.router.available()) {
      if (id === "stub") continue;
      const p = this.router.get(id);
      if (p) return p;
    }
    return undefined;
  }

  private buildRequest(
    brief: CreativeBrief,
    providerId: GenerationRequest["providerId"],
    pattern: Awaited<ReturnType<typeof resolveTopPattern>>,
    knowledgeData: string,
    lastCritique: Critique | undefined,
    iteration: number,
    pendingRevision: RevisionPrompt | undefined,
  ): GenerationRequest {
    const expectedKind = this.kindForDomain(brief.domain);
    const sysParts: string[] = ["You are an expert creative engineer producing production-ready artifacts."];
    if (pattern) sysParts.push(`Follow the "${pattern.name}" pattern. Required elements: ${pattern.requiredElements.map((e) => e.name).join(", ")}. Avoid anti-patterns: ${pattern.antiPatterns.map((a) => a.id).join(", ")}.`);
    if (knowledgeData) sysParts.push(knowledgeData);

    let userPrompt = `Intent: ${brief.intent}\nConstraints: ${brief.constraints.join("; ") || "(none)"}\nProduce a complete ${expectedKind} artifact.`;
    if (lastCritique) userPrompt += `\n\nPrevious score: ${lastCritique.aggregateScore}/100. Address: ${lastCritique.suggestions.slice(0, 5).map((s) => s.description).join("; ")}.`;
    if (pendingRevision) {
      return {
        providerId,
        systemPrompt: pendingRevision.systemPrompt,
        userPrompt: pendingRevision.userPrompt,
        expectedKind,
        temperature: 0.6,
        patternId: pattern?.id,
      };
    }
    return { providerId, systemPrompt: sysParts.join("\n\n"), userPrompt, expectedKind, temperature: 0.7, patternId: pattern?.id };
  }

  private async callProvider(provider: IProvider, req: GenerationRequest, session: Session): Promise<{ artifact: Artifact }> {
    const res = await provider.generate(req);
    session.totalTokens += res.usage.totalTokens;
    session.totalCostUsd += res.usage.costUsd;
    this.tracer.cost({ sessionId: session.id, providerId: res.providerId, model: res.model, tokens: res.usage.totalTokens, costUsd: res.usage.costUsd });
    const artifact: Artifact = { ...res.artifact, iteration: session.iterations.length, metadata: { tokens: res.usage.totalTokens, costUsd: res.usage.costUsd, model: res.model } };
    return { artifact };
  }

  private kindForDomain(domain: CreativeBrief["domain"]): GenerationRequest["expectedKind"] {
    if (domain === "react-three-fiber") return "jsx";
    if (domain === "three-js" || domain === "vfx" || domain === "frontend-animation" || domain === "game-development") return "js";
    if (domain === "ui-design" || domain === "web-design") return "html";
    return "html";
  }

  private recordLearning(session: Session, category?: string): void {
    if (!category) return;
    // bounded learning: record an observation; effectiveness updated; promotion
    // to a Pattern would go through PatternValidator + review gate (not here).
    void this.memory.byKey("pattern-effectiveness", category).then((rec) => {
      const eff = rec?.effectiveness ?? { attempts: 0, successes: 0, avgUplift: 0 };
      const firstScore = session.iterations[0]?.critique?.aggregateScore ?? 0;
      const uplift = (session.finalScore ?? 0) - firstScore;
      const success = (session.finalScore ?? 0) >= 80 ? 1 : 0;
      const attempts = eff.attempts + 1;
      const successes = eff.successes + success;
      const avgUplift = (eff.avgUplift * eff.attempts + uplift) / attempts;
      const updated = { attempts, successes, avgUplift: Math.round(avgUplift * 100) / 100, lastAppliedAt: new Date().toISOString() };
      if (rec) void this.memory.updateEffectiveness(rec.id, updated);
      else void this.memory.record({ kind: "pattern-effectiveness", patternCategory: category, key: category, value: `pattern category effectiveness for ${category}`, effectiveness: updated });
    }).catch(() => { /* learning is best-effort */ });
  }
}
