import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FilePatternRepository } from "../src/patterns/repository.js";
import { validatePattern } from "../src/patterns/validator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const patternsDir = path.resolve(here, "..", "patterns");

describe("pattern library", () => {
  it("loads all 22 patterns from disk with zero load errors", async () => {
    const repo = new FilePatternRepository(patternsDir, true);
    await repo.load();
    const errors = repo.loadErrorsList();
    expect(errors).toEqual([]);
    const all = repo.list();
    expect(all.length).toBe(22);
  });

  it("every pattern passes structural + semantic validation", async () => {
    const repo = new FilePatternRepository(patternsDir, true);
    await repo.load();
    for (const p of await repo.all()) {
      const r = validatePattern(p);
      expect(r.valid, `pattern ${p.id}: ${r.errors.join("; ")}`).toBe(true);
    }
  });

  it("each pattern has required fields, rules, anti-patterns, and examples", async () => {
    const repo = new FilePatternRepository(patternsDir, true);
    await repo.load();
    for (const p of await repo.all()) {
      expect(p.requiredElements.length).toBeGreaterThanOrEqual(4);
      expect(p.qualityRules.length).toBeGreaterThanOrEqual(5);
      expect(p.antiPatterns.length).toBeGreaterThanOrEqual(3);
      expect(p.exampleOutputs.length).toBeGreaterThanOrEqual(1);
      expect(p.provenance.trust).toBe("internal");
      // required elements all have required=true
      for (const e of p.requiredElements) expect(e.required).toBe(true);
      // rule weights per dimension sum to ~1.0
      const byDim = new Map<string, number>();
      for (const r of p.qualityRules) byDim.set(r.dimension, (byDim.get(r.dimension) ?? 0) + r.weight);
      for (const [, sum] of byDim) expect(Math.abs(sum - 1)).toBeLessThanOrEqual(0.001);
    }
  });

  it("list(category), search, and byDomain filter correctly", async () => {
    const repo = new FilePatternRepository(patternsDir, true);
    await repo.load();
    expect(repo.list("fantasy_fireball").length).toBe(1);
    expect(repo.byDomain("vfx").length).toBe(3); // fireball, lightning, magic-circle
    expect(repo.byDomain("game-development").length).toBe(8); // platformer, action, shooter, puzzle, racing, state-manager, ecs, skill-effect
    expect(repo.search("fireball").length).toBe(1);
    expect(repo.search("NONEXISTENT_TERM_ZZZ").length).toBe(0);
  });

  it("get(id) returns the full pattern body", async () => {
    const repo = new FilePatternRepository(patternsDir, true);
    await repo.load();
    const p = await repo.get("cyberpunk-dashboard");
    expect(p?.id).toBe("cyberpunk-dashboard");
    expect(p?.requiredElements.some((e) => e.name === "dark-base")).toBe(true);
  });
});
