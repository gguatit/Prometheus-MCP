import type { GenerationRequest, GenerationResponse, Pattern } from "../types/index.js";
import type { IProvider } from "./types.js";
import { CAPS, emptyArtifact, estimateTokens } from "./types.js";

/**
 * StubProvider — deterministic, no network, no API key. Returns pattern-grounded
 * template output so the entire pipeline is exercisable end-to-end offline and
 * in CI. This is REAL logic (it consults the pattern to produce a coherent
 * scaffold that the Critic can genuinely evaluate), not a mock that returns a
 * canned string regardless of input.
 *
 * It intentionally produces imperfect output (missing some required elements,
 * some anti-patterns present) so the Critic + Improvement loop has something
 * meaningful to do — proving the director actually works without a frontier
 * model.
 */
export class StubProvider implements IProvider {
  readonly id = "stub" as const;
  readonly capabilities = CAPS.stub;

  constructor(private readonly patterns: Map<string, Pattern> = new Map()) {}

  registerPattern(p: Pattern): void {
    this.patterns.set(p.id, p);
  }

  async generate(req: GenerationRequest): Promise<GenerationResponse> {
    const pattern = req.patternId ? this.patterns.get(req.patternId) : undefined;
    const content = this.synthesize(req, pattern);
    const completionTokens = estimateTokens(content);
    const promptTokens = estimateTokens(`${req.systemPrompt ?? ""}\n${req.userPrompt}`);
    const start = Date.now();
    return {
      artifact: emptyArtifact(req.expectedKind, "stub", 0, content, pattern?.name),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        costUsd: 0,
        latencyMs: Date.now() - start,
      },
      providerId: "stub",
      model: "stub-v1",
      finishReason: "stop",
    };
  }

  private synthesize(req: GenerationRequest, pattern: Pattern | undefined): string {
    const kind = req.expectedKind;
    const intent = req.userPrompt.split("\n").find((l) => l.trim().length > 0) ?? req.userPrompt;

    if (pattern) {
      return this.fromPattern(kind, intent, pattern);
    }
    return this.generic(kind, intent);
  }

  private fromPattern(kind: GenerationRequest["expectedKind"], intent: string, p: Pattern): string {
    const reqEls = p.requiredElements.map((e) => e.name);
    // Deliberately include most but not all required elements, plus one
    // anti-pattern signal, so the critic has real findings.
    const included = reqEls.slice(0, Math.max(1, reqEls.length - 1));
    const body = p.exampleOutputs[0]?.snippet ?? "";

    if (kind === "html" || kind === "jsx" || kind === "tsx") {
      const tag = kind === "html" ? "html" : "jsx";
      const els = included.map((n) => `    <div data-element="${n}" class="${n}"><!-- ${n} --></div>`).join("\n");
      return `<!-- ${p.name} :: ${intent.slice(0, 80)} -->
<${tag}>
  <head><meta charset="utf-8"><!-- viewport meta intentionally omitted for critic exercise --></head>
  <body>
    <main>
${els}
    </main>
    <style>
      body { margin: 0; font-family: system-ui; }
      .${included[0] ?? "root"} { padding: 1rem; }
    </style>
${body ? `    <!-- pattern example:\n${body}\n    -->` : ""}
  </body>
</${tag}>`;
    }

    if (kind === "js" || kind === "ts") {
      const fns = included.map((n) => `function ${n.replace(/-/g, "_")}() {\n  // ${n} implementation per ${p.name}\n  return {};\n}`).join("\n\n");
      return `// ${p.name} :: ${intent.slice(0, 80)}
// Required elements: ${included.join(", ")}
${fns}
`;
    }

    return `# ${p.name}\n\n${p.description}\n\nIntent: ${intent}\n\nIncluded elements: ${included.join(", ")}`;
  }

  private generic(kind: GenerationRequest["expectedKind"], intent: string): string {
    if (kind === "html") {
      return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${intent.slice(0, 40)}</title></head>
<body><main><h1>${intent.slice(0, 60)}</h1><p>Generated output.</p></main></body>
</html>`;
    }
    return `// ${intent.slice(0, 80)}\nexport function main() { return {}; }`;
  }
}
