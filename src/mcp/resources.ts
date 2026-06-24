import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDeps } from "./tools.js";

/**
 * registerResources — read-only views of internal state via resource URIs.
 * Clients that prefer retrieval over tool calls use these.
 */
export function registerResources(server: McpServer, deps: ToolDeps): void {
  // pattern://{patternId} — full pattern
  server.resource(
    "pattern",
    new ResourceTemplate("pattern://{patternId}", { list: undefined }),
    async (uri, { patternId }) => {
      const id = String(patternId);
      const p = await deps.patterns.get(id);
      if (!p) return { contents: [{ uri: uri.href, text: `Pattern "${id}" not found.`, mimeType: "text/plain" }] };
      return { contents: [{ uri: uri.href, text: JSON.stringify(p, null, 2), mimeType: "application/json" }] };
    },
  );

  // session://{sessionId} — session timeline
  server.resource(
    "session",
    new ResourceTemplate("session://{sessionId}", { list: undefined }),
    async (uri, { sessionId }) => {
      const s = await deps.history.get(String(sessionId));
      if (!s) return { contents: [{ uri: uri.href, text: `Session "${sessionId}" not found.`, mimeType: "text/plain" }] };
      return { contents: [{ uri: uri.href, text: JSON.stringify(s, null, 2), mimeType: "application/json" }] };
    },
  );

  // trends://quality — latest trend report
  server.resource(
    "quality-trends",
    "trends://quality",
    async (uri) => {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const report = await deps.analytics.qualityTrends(since);
      return { contents: [{ uri: uri.href, text: JSON.stringify(report, null, 2), mimeType: "application/json" }] };
    },
  );

  // config://runtime — runtime capabilities (no secrets)
  server.resource(
    "runtime-config",
    "config://runtime",
    async (uri) => {
      const view = {
        version: deps.config.version,
        defaultTargetScore: deps.config.defaultTargetScore,
        defaultMaxIterations: deps.config.defaultMaxIterations,
        enableLLMReasoning: deps.config.enableLLMReasoning,
        llmReasoningCap: deps.config.llmReasoningCap,
        dimensionWeights: deps.config.dimensionWeights,
        providers: deps.config.providers.map((p) => ({ id: p.id, enabled: p.enabled, defaultModel: p.defaultModel })),
        defaultProvider: deps.config.defaultProvider,
      };
      return { contents: [{ uri: uri.href, text: JSON.stringify(view, null, 2), mimeType: "application/json" }] };
    },
  );

  // pattern://category/{category} — patterns grouped by category
  server.resource(
    "patterns-by-category",
    new ResourceTemplate("pattern://category/{category}", { list: undefined }),
    async (uri, { category }) => {
      const list = deps.patterns.list(String(category));
      return { contents: [{ uri: uri.href, text: JSON.stringify(list, null, 2), mimeType: "application/json" }] };
    },
  );
}
