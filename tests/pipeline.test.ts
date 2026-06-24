import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultConfig, validateConfig } from "../src/infrastructure/config.js";
import { NoopSink } from "../src/infrastructure/telemetry.js";
import { FilePatternRepository } from "../src/patterns/repository.js";
import { FileHistoryRepository, FileMemoryRepository } from "../src/memory/repository.js";
import { KnowledgeCollectorService, InternalPatternCollector } from "../src/knowledge/collector.js";
import { CriticEngine } from "../src/critic/engine.js";
import { ImprovementEngine } from "../src/improver/engine.js";
import { ProviderRouter } from "../src/providers/router.js";
import { StubProvider } from "../src/providers/stub.js";
import { Orchestrator } from "../src/pipeline/orchestrator.js";
import { makeBrief } from "../src/pipeline/planner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "..");
const patternsDir = path.resolve(rootDir, "patterns");

let tmp: string;

async function buildOrchestrator() {
  const base = defaultConfig(rootDir);
  base.enableLLMReasoning = false; // deterministic
  base.historyDir = path.join(tmp, "history");
  base.memoryDir = path.join(tmp, "memory");
  const config = validateConfig(base);

  const patterns = new FilePatternRepository(patternsDir, true);
  await patterns.load();
  const history = new FileHistoryRepository(config.historyDir);
  const memory = new FileMemoryRepository(config.memoryDir);
  await memory.load();

  const stub = new StubProvider();
  for (const p of await patterns.all()) stub.registerPattern(p);
  const router = new ProviderRouter(new Map([["stub", stub]]), { defaultProvider: "stub" });

  const knowledge = new KnowledgeCollectorService([new InternalPatternCollector(await patterns.all())]);
  const critic = new CriticEngine(config);
  const improver = new ImprovementEngine();
  return new Orchestrator(config, patterns, knowledge, critic, improver, router, history, memory, new NoopSink());
}

describe("orchestrator (end-to-end, stub provider, deterministic)", () => {
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "prom-test-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("runs a full generate→critique→improve loop and finalizes a session", async () => {
    const orchestrator = await buildOrchestrator();
    const brief = makeBrief({ intent: "build a fantasy fireball vfx with particles", targetScore: 99, maxIterations: 1 }, validateConfig(defaultConfig(rootDir)));
    const session = await orchestrator.run(brief);
    expect(session.iterations.length).toBeGreaterThanOrEqual(1);
    expect(session.finalScore).toBeGreaterThanOrEqual(0);
    expect(session.finalScore).toBeLessThanOrEqual(100);
    expect(session.status === "completed" || session.status === "terminated").toBe(true);
    expect(session.terminationReason).toContain("max iterations");
    expect(session.providerUsed).toBe("stub");
  }, 30_000);

  it("is deterministic: two runs with the same brief produce the same final score", async () => {
    const orchestrator = await buildOrchestrator();
    const mk = () => makeBrief({ intent: "cyberpunk dashboard", targetScore: 99, maxIterations: 1 }, validateConfig(defaultConfig(rootDir)));
    const s1 = await orchestrator.run(mk());
    const s2 = await orchestrator.run(mk());
    expect(s1.finalScore).toBe(s2.finalScore);
  }, 30_000);
});
