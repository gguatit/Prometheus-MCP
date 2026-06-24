import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig, validateConfig } from "../src/infrastructure/config.js";
import { CriticEngine } from "../src/critic/engine.js";
import { collectEvidence } from "../src/critic/evidence.js";
import { runRules } from "../src/critic/rules.js";
import { score } from "../src/critic/scoring.js";
import type { Artifact } from "../src/types/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "..");

function cfg() {
  const c = defaultConfig(rootDir);
  c.enableLLMReasoning = false; // deterministic: no LLM reasoning in CI
  return validateConfig(c);
}

function art(kind: Artifact["kind"], content: string): Artifact {
  return { id: "art-test", kind, content, generatedAt: new Date().toISOString(), providerId: "stub", iteration: 0 };
}

const GOOD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Good</title>
  <style>:root{--c:#111}body{font:16px/1.6 system-ui;color:#111;background:#fff}</style>
</head>
<body>
  <header><h1>Title</h1></header>
  <main>
    <section aria-label="content"><p>Hello world</p></section>
    <img src="a.png" alt="descriptive alt">
    <button type="button">Act</button>
  </main>
  <footer>2026</footer>
</body>
</html>`;

const BAD_HTML = `<div>
  <DIV>no doctype, no lang, no viewport, no alt</DIV>
  <img src=x>
  <span onclick=x>click</span>
</div>`;

describe("critic evidence collector", () => {
  it("detects viewport meta, lang, and alt coverage on good HTML", () => {
    const e = collectEvidence(art("html", GOOD_HTML), {});
    expect(e.valid).toBe(true);
    expect(e.parseErrors).toEqual([]);
    expect(e.signals.find((s) => s.id === "resp-viewport")?.value).toBe(1);
    expect(e.signals.find((s) => s.id === "a11y-lang")?.value).toBe(1);
    expect(e.signals.find((s) => s.id === "a11y-alt")?.value).toBeGreaterThan(0.99);
  });

  it("flags missing viewport, lang, and alt on bad HTML", () => {
    const e = collectEvidence(art("html", BAD_HTML), {});
    expect(e.signals.find((s) => s.id === "resp-viewport")?.value).toBe(0);
    expect(e.signals.find((s) => s.id === "a11y-lang")?.value).toBe(0);
    expect(e.signals.find((s) => s.id === "a11y-alt")?.value).toBeLessThan(0.5);
  });
});

describe("critic scoring", () => {
  it("produces 0..100 dimension scores and an aggregate in range", () => {
    const evidence = collectEvidence(art("html", GOOD_HTML), {});
    const rr = runRules({ artifact: art("html", GOOD_HTML), evidence, pattern: undefined });
    const out = score({ ruleResults: rr, dimensionWeights: cfg().dimensionWeights });
    expect(out.aggregateScore).toBeGreaterThanOrEqual(0);
    expect(out.aggregateScore).toBeLessThanOrEqual(100);
    for (const d of ["visual-impact", "accessibility", "responsiveness"] as const) {
      expect(out.dimensionScores[d]).toBeGreaterThanOrEqual(0);
      expect(out.dimensionScores[d]).toBeLessThanOrEqual(100);
    }
    expect(out.contributions.length).toBeGreaterThan(0);
  });

  it("a good artifact scores materially higher than a bad one", () => {
    const c = cfg();
    const goodE = collectEvidence(art("html", GOOD_HTML), {});
    const badE = collectEvidence(art("html", BAD_HTML), {});
    const goodS = score({ ruleResults: runRules({ artifact: art("html", GOOD_HTML), evidence: goodE, pattern: undefined }), dimensionWeights: c.dimensionWeights });
    const badS = score({ ruleResults: runRules({ artifact: art("html", BAD_HTML), evidence: badE, pattern: undefined }), dimensionWeights: c.dimensionWeights });
    expect(goodS.aggregateScore).toBeGreaterThan(badS.aggregateScore);
    expect(goodS.aggregateScore - badS.aggregateScore).toBeGreaterThanOrEqual(10);
  });
});

describe("critic engine (end-to-end, deterministic)", () => {
  it("emits a full Critique with findings, suggestions, and a recommended next step", async () => {
    const critic = new CriticEngine(cfg());
    const critique = await critic.critique(art("html", GOOD_HTML), { sessionId: "test" });
    expect(critique.aggregateScore).toBeGreaterThanOrEqual(0);
    expect(critique.aggregateScore).toBeLessThanOrEqual(100);
    expect(critique.findings.length).toBeGreaterThan(0);
    expect(critique.suggestions.length).toBeGreaterThanOrEqual(0);
    expect(["finalize", "regenerate", "research", "reselect", "improve"]).toContain(critique.recommendedNextStep);
    expect(critique.justification.length).toBeGreaterThan(0);
    // every contribution cites a rule and a dimension delta
    for (const j of critique.justification) {
      expect(j.ruleId).toBeTruthy();
      expect(j.dimension).toBeTruthy();
    }
  });
});
