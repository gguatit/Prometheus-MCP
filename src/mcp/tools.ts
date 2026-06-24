import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DirectCreativeWorkShape, CritiqueArtifactShape, ImproveArtifactShape, ListPatternsShape, GetPatternShape, RecallSessionsShape, GetQualityTrendsShape,
} from "./schemas.js";
import type { RuntimeConfig } from "../infrastructure/config.js";
import { makeBrief } from "../pipeline/planner.js";
import type { Orchestrator } from "../pipeline/orchestrator.js";
import { CriticEngine } from "../critic/engine.js";
import { ImprovementEngine } from "../improver/engine.js";
import { ProviderRouter } from "../providers/router.js";
import type { IPatternRepository } from "../patterns/repository.js";
import type { IHistoryRepository, IMemoryRepository, IAnalyticsRepository } from "../memory/repository.js";
import { newId } from "../infrastructure/telemetry.js";
import type { Artifact, Critique } from "../types/index.js";

/** Cast a typed structuredContent object to the SDK's required index-signature shape. */
const sc = <T,>(v: T): Record<string, unknown> => v as unknown as Record<string, unknown>;

/**
 * registerTools — wires the 7 MCP tools to real logic. Each handler validates
 * (via SDK + zod), wraps work in the shared dependencies, and returns
 * { content:[{type:'text',text}], structuredContent }.
 */
export interface ToolDeps {
  config: RuntimeConfig;
  orchestrator: Orchestrator;
  critic: CriticEngine;
  improver: ImprovementEngine;
  router: ProviderRouter;
  patterns: IPatternRepository;
  history: IHistoryRepository;
  memory: IMemoryRepository;
  analytics: IAnalyticsRepository;
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  // --- direct_creative_work --------------------------------------------------
  server.tool(
    "direct_creative_work",
    "End-to-end creative direction: generate, critique, and iteratively improve an artifact to a target quality score. This is the primary tool (~80% of usage).",
    DirectCreativeWorkShape,
    async (input) => {
      const brief = makeBrief(
        {
          intent: input.intent,
          domain: input.domain,
          targetScore: input.targetScore,
          maxIterations: input.maxIterations,
          costBudgetUsd: input.costBudgetUsd,
          provider: input.provider,
          seedArtifact: input.seedArtifact,
          constraints: input.constraints,
        },
        deps.config,
      );
      const session = await deps.orchestrator.run(brief);
      const final = session.iterations[session.iterations.length - 1];
      const text = renderSessionSummary(session);
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          sessionId: session.id,
          status: session.status,
          finalScore: session.finalScore,
          iterations: session.iterations.length,
          providerUsed: session.providerUsed,
          patternIds: session.patternIds,
          terminationReason: session.terminationReason,
          finalArtifact: final?.artifact,
          finalCritique: final?.critique,
        },
      };
    },
  );

  // --- critique_artifact -----------------------------------------------------
  server.tool(
    "critique_artifact",
    "Evaluate an existing artifact with the expert Critic engine (evidence + rules + optional LLM reasoning). Returns dimension scores, findings, and prioritized suggestions. Does not generate.",
    CritiqueArtifactShape,
    async (input) => {
      const pattern = input.patternId ? await deps.patterns.get(input.patternId) : undefined;
      const artifact: Artifact = {
        id: newId("art"),
        kind: input.artifact.kind,
        content: input.artifact.content,
        label: input.artifact.label,
        generatedAt: new Date().toISOString(),
        providerId: "stub",
        iteration: 0,
      };
      const reasoningProvider = firstNonStubProvider(deps.router);
      const critique: Critique = await deps.critic.critique(artifact, { pattern, sessionId: "ad-hoc", reasoningProvider });
      return {
        content: [{ type: "text", text: renderCritiqueSummary(critique) }],
        structuredContent: sc(critique),
      };
    },
  );

  // --- improve_artifact ------------------------------------------------------
  server.tool(
    "improve_artifact",
    "Produce a structured improvement plan and a revised artifact from an existing artifact (and optional prior critique). One-shot improvement; for iterative work use direct_creative_work.",
    ImproveArtifactShape,
    async (input) => {
      const pattern = input.patternId ? await deps.patterns.get(input.patternId) : undefined;
      const artifact: Artifact = {
        id: newId("art"),
        kind: input.artifact.kind,
        content: input.artifact.content,
        generatedAt: new Date().toISOString(),
        providerId: "stub",
        iteration: 0,
      };
      const reasoningProvider = firstNonStubProvider(deps.router);
      let critique: Critique;
      if (input.critique) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(input.critique);
        } catch {
          return { content: [{ type: "text", text: "Error: critique input is not valid JSON." }] };
        }
        if (!parsed || typeof parsed !== "object" || !("aggregateScore" in parsed) || !("findings" in parsed)) {
          return { content: [{ type: "text", text: "Error: critique input missing required fields (aggregateScore, findings)." }] };
        }
        critique = parsed as Critique;
      } else {
        critique = await deps.critic.critique(artifact, { pattern, sessionId: "ad-hoc", reasoningProvider });
      }
      const { plan, revision } = await deps.improver.improve(artifact, critique, { pattern, memory: deps.memory });
      const provider = input.provider ? deps.router.get(input.provider) ?? deps.router.select([]) : deps.router.select([]);
      const gen = await provider.generate({
        providerId: provider.id,
        systemPrompt: revision.systemPrompt,
        userPrompt: revision.userPrompt,
        expectedKind: artifact.kind,
        patternId: pattern?.id,
      });
      const improved: Artifact = { ...gen.artifact, iteration: 1 };
      return {
        content: [{ type: "text", text: `Improved artifact (plan scope: ${plan.regenerateScope}). Expected uplift: +${plan.expectedUplift}.` }],
        structuredContent: { plan, revisedArtifact: improved, usage: gen.usage },
      };
    },
  );

  // --- list_patterns ---------------------------------------------------------
  server.tool(
    "list_patterns",
    "Browse the expert pattern library, optionally filtered by category or free-text query.",
    ListPatternsShape,
    async (input) => {
      const summaries = input.query ? deps.patterns.search(input.query) : deps.patterns.list(input.category);
      return {
        content: [{ type: "text", text: `${summaries.length} pattern(s) available.` }],
        structuredContent: { patterns: summaries },
      };
    },
  );

  // --- get_pattern -----------------------------------------------------------
  server.tool(
    "get_pattern",
    "Fetch a full pattern definition by id.",
    GetPatternShape,
    async (input) => {
      const p = await deps.patterns.get(input.patternId);
      if (!p) return { content: [{ type: "text", text: `Pattern "${input.patternId}" not found.` }], structuredContent: { found: false } };
      return { content: [{ type: "text", text: `Pattern: ${p.name} (v${p.version})` }], structuredContent: sc(p) };
    },
  );

  // --- recall_sessions -------------------------------------------------------
  server.tool(
    "recall_sessions",
    "Retrieve past sessions from long-term memory (history), optionally filtered by query.",
    RecallSessionsShape,
    async (input) => {
      const limit = input.limit ?? 10;
      const sessions = input.query ? await deps.history.search(input.query, limit) : await deps.history.recent(limit);
      return {
        content: [{ type: "text", text: `${sessions.length} session(s).` }],
        structuredContent: { sessions: sessions.map(summarizeSession) },
      };
    },
  );

  // --- get_quality_trends ----------------------------------------------------
  server.tool(
    "get_quality_trends",
    "Aggregate quality trends and top patterns from analytics memory.",
    GetQualityTrendsShape,
    async (input) => {
      const since = input.since ? new Date(input.since) : new Date(Date.now() - 30 * 86_400_000);
      const report = await deps.analytics.qualityTrends(since, input.domain);
      return {
        content: [{ type: "text", text: `Trends since ${since.toISOString().slice(0, 10)}: ${report.points.length} buckets, ${report.topPatterns.length} top patterns.` }],
        structuredContent: sc(report),
      };
    },
  );
}

function firstNonStubProvider(router: ProviderRouter) {
  for (const id of router.available()) {
    if (id === "stub") continue;
    return router.get(id);
  }
  return undefined;
}

function renderSessionSummary(s: import("../types/index.js").Session): string {
  const score = s.finalScore !== undefined ? `${s.finalScore}/100` : "(no score)";
  return `Session ${s.id} — ${s.status}. Final: ${score}. Iterations: ${s.iterations.length}. Provider: ${s.providerUsed}. Patterns: ${s.patternIds.join(", ") || "(none)"}. ${s.terminationReason ? `Reason: ${s.terminationReason}.` : ""}`;
}

function renderCritiqueSummary(c: Critique): string {
  return `Critique — aggregate ${c.aggregateScore}/100 (target reached: ${c.recommendedNextStep === "finalize"}). ${c.findings.length} findings, ${c.suggestions.length} suggestions. Expected uplift if applied: +${c.expectedUpliftIfApplied}.`;
}

function summarizeSession(s: import("../types/index.js").Session) {
  return {
    id: s.id,
    briefId: s.briefId,
    status: s.status,
    startedAt: s.startedAt,
    finalScore: s.finalScore,
    iterations: s.iterations.length,
    providerUsed: s.providerUsed,
    patternIds: s.patternIds,
    terminationReason: s.terminationReason,
  };
}
