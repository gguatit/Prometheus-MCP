#!/usr/bin/env node
/**
 * Prometheus-MCP server entry.
 *
 * Assembles the 14 internal modules, wires the MCP surface (7 tools, 5
 * resources, 4 prompts) to real logic, and serves over stdio (MVP transport).
 * Roadmap: StreamableHTTP for remote enterprise (same registration, different
 * transport).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultConfig, applyEnv, validateConfig } from "./infrastructure/config.js";
import { ConsoleJsonSink, CompositeSink, SecretRedactor, NoopSink } from "./infrastructure/telemetry.js";
import { LruCache } from "./infrastructure/cache.js";
import { FilePatternRepository } from "./patterns/repository.js";
import { FileHistoryRepository, FileMemoryRepository, AnalyticsService } from "./memory/repository.js";
import { KnowledgeCollectorService } from "./knowledge/collector.js";
import { InternalPatternCollector, Context7CuratedCollector } from "./knowledge/collector.js";
import { CriticEngine } from "./critic/engine.js";
import { ImprovementEngine } from "./improver/engine.js";
import { ProviderRouter } from "./providers/router.js";
import { StubProvider } from "./providers/stub.js";
import { OpenAICompatibleProvider } from "./providers/openai-compatible.js";
import { ClaudeProvider } from "./providers/claude.js";
import { Orchestrator } from "./pipeline/orchestrator.js";
import { registerTools } from "./mcp/tools.js";
import { registerResources } from "./mcp/resources.js";
import { registerPrompts } from "./mcp/prompts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "..");

export async function buildServer(): Promise<McpServer> {
  const baseConfig = defaultConfig(rootDir);
  const config = validateConfig(applyEnv(baseConfig));

  // --- telemetry ---
  const rawSink = process.env.PROMETHEUS_TELEMETRY === "json" ? new ConsoleJsonSink() : new NoopSink();
  const sink = new SecretRedactor(new CompositeSink([rawSink]));

  // --- repositories ---
  const patterns = new FilePatternRepository(config.patternsDir, config.allowCommunityPatternsInCritic);
  await patterns.load();
  const history = new FileHistoryRepository(config.historyDir);
  const memory = new FileMemoryRepository(config.memoryDir);
  await memory.load();
  const analytics = new AnalyticsService(history);

  // cache (MVP: in-memory LRU)
  const cache = new LruCache<string>(64);
  void cache;

  // --- providers (capability-based) ---
  const providersMap = new Map();
  const stub = new StubProvider();
  // register stub patterns for grounding
  for (const p of await patterns.all()) stub.registerPattern(p);
  providersMap.set("stub", stub);
  for (const pc of config.providers) {
    if (!pc.enabled) continue;
    if (pc.id === "claude") {
      providersMap.set("claude", new ClaudeProvider(pc));
    } else if (pc.id !== "stub") {
      providersMap.set(pc.id, new OpenAICompatibleProvider(pc.id, pc));
    }
  }
  const router = new ProviderRouter(providersMap, {
    defaultProvider: config.defaultProvider,
    costRanking: ["deepseek", "qwen", "glm", "openai", "claude"],
  });

  // --- knowledge ---
  const knowledge = new KnowledgeCollectorService([
    new InternalPatternCollector(await patterns.all()),
    new Context7CuratedCollector(),
  ]);

  // --- core engines ---
  const critic = new CriticEngine(config);
  const improver = new ImprovementEngine();

  const orchestrator = new Orchestrator(config, patterns, knowledge, critic, improver, router, history, memory, sink);

  // --- MCP server ---
  // Capabilities (tools/resources/prompts/logging) are auto-advertised by the
  // high-level McpServer based on what is registered below.
  const server = new McpServer({
    name: "prometheus-mcp",
    version: config.version,
  });

  registerTools(server, { config, orchestrator, critic, improver, router, patterns, history, memory, analytics });
  registerResources(server, { config, orchestrator, critic, improver, router, patterns, history, memory, analytics });
  registerPrompts(server);

  return server;
}

async function main(): Promise<void> {
  const server = await buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// run only when executed directly (not imported, e.g. by tests)
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const thisFile = path.resolve(here, "index.js");
const moduleUrl = import.meta.url;
if (invokedPath === thisFile || moduleUrl === `file://${invokedPath.replace(/\\/g, "/")}`) {
  main().catch((e) => {
    console.error("prometheus-mcp fatal:", e);
    process.exit(1);
  });
}
