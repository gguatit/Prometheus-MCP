import type { CreativeBrief, KnowledgeFragment, Pattern } from "../types/index.js";
import { sanitize, assembleKnowledgeData } from "../infrastructure/security.js";
import { newId } from "../infrastructure/telemetry.js";
import { CURATED_FRAGMENTS } from "./curated/fragments.js";

/**
 * KnowledgeCollector — pluggable source collectors by priority:
 *   1. Context7 (roadmap; interface ready)
 *   2. Official docs (roadmap)
 *   3. GitHub examples (roadmap)
 *   4. Internal pattern library (primary in MVP)
 *   5. External MCP providers (roadmap)
 *
 * All external content is UNTRUSTED DATA and passes the Sanitizer before use.
 * Adding a source = implement IKnowledgeCollector and register it; the
 * orchestrator is unchanged.
 */

export interface KnowledgeCollectResult {
  fragments: KnowledgeFragment[];
  dataBlock: string; // sanitized, assembled, fenced — safe for prompt inclusion
  quarantinedCount: number;
}

export interface IKnowledgeCollector {
  readonly source: KnowledgeFragment["source"];
  collect(brief: CreativeBrief): Promise<KnowledgeFragment[]>;
}

/** Internal pattern knowledge — patterns are trusted content (validated). */
export class InternalPatternCollector implements IKnowledgeCollector {
  readonly source = "internal-pattern" as const;
  constructor(private readonly patterns: Pattern[]) {}

  async collect(brief: CreativeBrief): Promise<KnowledgeFragment[]> {
    return this.patterns.map((p) => {
      const content = `Pattern: ${p.name} (v${p.version})\n${p.description}\nRequired elements: ${p.requiredElements.map((e) => e.name).join(", ")}\nQuality rules: ${p.qualityRules.map((r) => `${r.id}(${r.dimension},w=${r.weight})`).join(", ")}\nAnti-patterns: ${p.antiPatterns.map((a) => a.id).join(", ")}`;
      // patterns are internal/trusted, but still fenced as data downstream.
      return sanitize(content, { source: "internal-pattern", title: p.name, trust: p.provenance.trust });
    }).filter((f) => brief.domain !== undefined);
  }
}

/** Stub external collector (no network) — demonstrates the seam. Roadmap: real Context7/docs/GitHub. */
export class StubExternalCollector implements IKnowledgeCollector {
  readonly source = "official-doc" as const;
  async collect(_brief: CreativeBrief): Promise<KnowledgeFragment[]> {
    return [{
      id: newId("kf"),
      source: "official-doc",
      title: "(no external knowledge in MVP)",
      content: "",
      trust: "community",
      quarantined: true,
      collectedAt: new Date().toISOString(),
    }];
  }
}

/**
 * Context7CuratedCollector — serves embedded knowledge fragments extracted
 * from Context7 research (Three.js, R3F, WebGPU, Phaser, Rapier, shaders,
 * game feel). NO network, NO API key — fully deterministic and offline.
 *
 * Fragments are filtered by domain relevance to the brief. All content is
 * trusted (verified) and passes the sanitizer downstream as data.
 *
 * Roadmap: a live Context7Collector can replace this by implementing the
 * same IKnowledgeCollector interface and calling the Context7 MCP at runtime.
 */
export class Context7CuratedCollector implements IKnowledgeCollector {
  readonly source = "official-doc" as const;

  async collect(brief: CreativeBrief): Promise<KnowledgeFragment[]> {
    const domainKeywords: Record<string, string[]> = {
      "three-js": ["threejs", "renderer", "geometry", "material", "dispose", "instanced", "particle", "postprocessing", "bloom", "webgl", "context"],
      "react-three-fiber": ["r3f", "useframe", "canvas", "useThree", "drei", "scene", "ref"],
      "vfx": ["particle", "shader", "blending", "bloom", "glsl", "additive", "fireball", "effect"],
      "game-development": ["game", "juice", "shake", "physics", "input", "loop", "timestep", "phaser", "rapier", "collision"],
      "creative-coding": ["shader", "glsl", "webgl", "webgpu", "canvas", "particle", "generative"],
      "interactive-experience": ["input", "animation", "easing", "tween", "interactive", "scene"],
      "frontend-animation": ["easing", "lerp", "tween", "animation", "delta", "framerate"],
    };
    const keywords = domainKeywords[brief.domain] ?? [];
    if (keywords.length === 0) return [];

    return CURATED_FRAGMENTS.filter((f) => {
      const lower = (f.title + " " + f.content).toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    }).map((f) => sanitize(f.content, { source: "official-doc", title: f.title, trust: "verified" }));
  }
}

export class KnowledgeCollectorService {
  constructor(private readonly collectors: IKnowledgeCollector[]) {}

  async collect(brief: CreativeBrief): Promise<KnowledgeCollectResult> {
    let all: KnowledgeFragment[] = [];
    for (const c of this.collectors) {
      try {
        const frags = await c.collect(brief);
        all = all.concat(frags);
      } catch {
        // a failed source must not break the pipeline
      }
    }
    const quarantinedCount = all.filter((f) => f.quarantined).length;
    return { fragments: all, dataBlock: assembleKnowledgeData(all), quarantinedCount };
  }
}
