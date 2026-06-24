import { describe, it, expect } from "vitest";
import { defaultConfig, validateConfig } from "../src/infrastructure/config.js";
import { makeBrief, terminationPolicy, detectDomain } from "../src/pipeline/planner.js";
import { shouldTerminate, newIteration, newSession, type LoopContext } from "../src/pipeline/loop.js";
import type { TerminationPolicy, Critique, Session } from "../src/types/index.js";

const cfg = validateConfig(defaultConfig(""));

function policy(over: Partial<TerminationPolicy>): TerminationPolicy {
  return { targetScore: 90, maxIterations: 3, maxCostUsd: 1, maxWallClockMs: 60_000, minDeltaImprovement: 3, maxFlatIterations: 2, ...over };
}

function critique(score: number): Critique {
  return {
    id: "c", artifactId: "a", sessionId: "s", generatedAt: new Date().toISOString(), version: "0.1.0",
    aggregateScore: score, dimensionScores: {} as Critique["dimensionScores"], findings: [], suggestions: [],
    justification: [], expectedUpliftIfApplied: 0, recommendedNextStep: "regenerate",
  } as Critique;
}

function sessionWith(iterations: { critique?: Critique }[]): Session {
  const s = newSession(makeBrief({ intent: "x" }, cfg));
  s.iterations = iterations.map((it, i) => ({ ...newIteration(i), critique: it.critique }));
  return s;
}

function ctx(over: Partial<LoopContext> & { policy: TerminationPolicy; session: Session }): LoopContext {
  return {
    brief: makeBrief({ intent: "x" }, cfg),
    policy: over.policy,
    session: over.session,
    iteration: over.iteration ?? newIteration(0),
    flatIterations: over.flatIterations ?? 0,
    startedWallMs: over.startedWallMs ?? Date.now(),
    accumulatedCostUsd: over.accumulatedCostUsd ?? 0,
    state: over.state ?? "critique",
    lastCritique: over.lastCritique,
  };
}

describe("planner", () => {
  it("detects domains from intent keywords", () => {
    expect(detectDomain("build a fireball vfx")).toBe("vfx");
    expect(detectDomain("react three fiber scene")).toBe("react-three-fiber");
    expect(detectDomain("modern landing page")).toBe("web-design");
    expect(detectDomain("something weird")).toBe("creative-coding");
  });

  it("makeBrief applies config defaults and user overrides", () => {
    const b = makeBrief({ intent: "x", targetScore: 95, maxIterations: 5 }, cfg);
    expect(b.targetScore).toBe(95);
    expect(b.maxIterations).toBe(5);
    const b2 = makeBrief({ intent: "x" }, cfg);
    expect(b2.targetScore).toBe(cfg.defaultTargetScore);
    expect(b2.maxIterations).toBe(cfg.defaultMaxIterations);
  });

  it("terminationPolicy carries brief + config limits", () => {
    const b = makeBrief({ intent: "x" }, cfg);
    const p = terminationPolicy(b, cfg);
    expect(p.targetScore).toBe(b.targetScore);
    expect(p.maxIterations).toBe(b.maxIterations);
    expect(p.maxWallClockMs).toBe(cfg.defaultMaxWallClockMs);
  });
});

describe("loop termination policy", () => {
  it("terminates when target score reached", () => {
    const p = policy({ targetScore: 80, maxIterations: 9 });
    const c = ctx({ policy: p, session: sessionWith([{}]), lastCritique: critique(85) });
    expect(shouldTerminate(c).terminate).toBe(true);
  });

  it("terminates at max iterations", () => {
    const p = policy({ targetScore: 99, maxIterations: 3 });
    expect(shouldTerminate(ctx({ policy: p, session: sessionWith([{}, {}, {}]), lastCritique: critique(50) })).terminate).toBe(true);
    expect(shouldTerminate(ctx({ policy: p, session: sessionWith([{}, {}]), lastCritique: critique(50) })).terminate).toBe(false);
  });

  it("terminates when cost budget exceeded", () => {
    const p = policy({ targetScore: 99, maxIterations: 99, maxCostUsd: 0.5 });
    expect(shouldTerminate(ctx({ policy: p, session: sessionWith([{}]), lastCritique: critique(50), accumulatedCostUsd: 0.6 })).terminate).toBe(true);
  });

  it("terminates on wall-clock budget", () => {
    const p = policy({ targetScore: 99, maxIterations: 99, maxWallClockMs: 100 });
    expect(shouldTerminate(ctx({ policy: p, session: sessionWith([{}]), lastCritique: critique(50), startedWallMs: Date.now() - 200 })).terminate).toBe(true);
  });

  it("terminates after max flat iterations with sub-threshold delta", () => {
    const p = policy({ targetScore: 99, maxIterations: 99, maxFlatIterations: 2, minDeltaImprovement: 3 });
    // two completed iterations: prev scored 50, last scored 51 (delta 1 < 3)
    const s = sessionWith([{ critique: critique(50) }, { critique: critique(51) }]);
    expect(shouldTerminate(ctx({ policy: p, session: s, lastCritique: critique(51), flatIterations: 2 })).terminate).toBe(true);
    expect(shouldTerminate(ctx({ policy: p, session: s, lastCritique: critique(51), flatIterations: 1 })).terminate).toBe(false);
  });

  it("does not terminate when still improving within budget", () => {
    const p = policy({ targetScore: 99, maxIterations: 9, maxFlatIterations: 2 });
    const s = sessionWith([{ critique: critique(40) }, { critique: critique(70) }]);
    expect(shouldTerminate(ctx({ policy: p, session: s, lastCritique: critique(70), flatIterations: 0 })).terminate).toBe(false);
  });
});
