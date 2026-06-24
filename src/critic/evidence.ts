import type {
  Artifact,
  Evidence,
  EvidenceSignal,
  ArtifactMetrics,
  Pattern,
  PatternConformance,
} from "../types/index.js";

/**
 * EvidenceCollector — the mandatory stage before the Critic. Produces
 * DETERMINISTIC facts about an artifact: parse validity, accessibility,
 * responsiveness, performance heuristics, and pattern conformance. These are
 * measured, not text-reasoned. LLM reasoning later is bound by these signals
 * (must cite ids, ±15 cap).
 *
 * MVP evidence uses AST-lite/regex heuristics (honestly labeled). The interface
 * is stable so Phase-1 can swap in headless render → axe/Lighthouse → vision.
 */

export interface EvidenceOptions {
  pattern?: Pattern;
}

export function collectEvidence(artifact: Artifact, opts: EvidenceOptions = {}): Evidence {
  const content = artifact.content;
  const parseErrors: string[] = [];
  const signals: EvidenceSignal[] = [];

  const metrics = measure(content, artifact.kind);
  const valid = checkValidity(content, artifact.kind, parseErrors);

  signals.push(...a11ySignals(content, artifact.kind));
  signals.push(...responsiveSignals(content, artifact.kind, metrics));
  signals.push(...performanceSignals(metrics));
  signals.push(...structureSignals(content, artifact.kind, metrics, valid, parseErrors));

  const conformance = patternConformance(content, opts.pattern);

  if (opts.pattern) {
    signals.push(...patternSignals(conformance, opts.pattern));
  }

  return {
    artifactId: artifact.id,
    collectedAt: new Date().toISOString(),
    valid,
    parseErrors,
    signals,
    patternConformance: conformance,
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export function measure(content: string, kind: Artifact["kind"]): ArtifactMetrics {
  const linesOfCode = content.split(/\r?\n/).length;
  const bytes = Buffer.byteLength(content, "utf8");
  const isMarkup = kind === "html" || kind === "jsx" || kind === "tsx";

  const elementCount = isMarkup ? (content.match(/<[a-zA-Z][^>]*>/g) ?? []).length : 0;
  const mediaQueryCount = (content.match(/@media[^{]+{/g) ?? []).length;
  const animationCount =
    (content.match(/animation\s*:/g) ?? []).length +
    (content.match(/requestAnimationFrame/g) ?? []).length +
    (content.match(/useFrame/g) ?? []).length;
  const importCount = (content.match(/^\s*import\s/gm) ?? []).length;

  const hasViewportMeta = /<meta[^>]+name=["']viewport["']/i.test(content);
  const altTextCoverage = computeAltCoverage(content, isMarkup);
  const semanticLandmarkCount = isMarkup
    ? (content.match(/<(header|nav|main|section|article|aside|footer|figure|figcaption)\b/gi) ?? []).length
    : 0;

  // very rough bundle estimate (bytes of inline code; external imports ~5kb each)
  const estimatedBundleKb = Math.round((bytes / 1024 + importCount * 5) * 10) / 10;

  return {
    linesOfCode,
    bytes,
    elementCount,
    mediaQueryCount,
    animationCount,
    importCount,
    hasViewportMeta,
    altTextCoverage,
    semanticLandmarkCount,
    estimatedBundleKb,
  };
}

function computeAltCoverage(content: string, isMarkup: boolean): number {
  if (!isMarkup) return 1;
  const imgs = content.match(/<img\b[^>]*>/gi) ?? [];
  if (imgs.length === 0) return 1;
  const withAlt = imgs.filter((t) => /\balt\s*=\s*["'][^"']+["']/i.test(t) && !/\balt\s*=\s*["']\s*["']/i.test(t)).length;
  return withAlt / imgs.length;
}

// ---------------------------------------------------------------------------
// Validity (structural parse for markup; brace/paren balance for JS/TS)
// ---------------------------------------------------------------------------

function checkValidity(content: string, kind: Artifact["kind"], errors: string[]): boolean {
  if (kind === "html" || kind === "jsx" || kind === "tsx") {
    return checkMarkupBalance(content, errors, kind !== "html");
  }
  if (kind === "js" || kind === "ts") {
    return checkBraceBalance(content, errors);
  }
  if (kind === "json") {
    try {
      JSON.parse(content);
      return true;
    } catch (e) {
      errors.push(`invalid JSON: ${(e as Error).message}`);
      return false;
    }
  }
  return true; // text/css/markdown — no structural validity check in MVP
}

function checkBraceBalance(content: string, errors: string[]): boolean {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let inString: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    const next = content[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "/" && next === "/") { inLineComment = true; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (ch === ")" || ch === "]" || ch === "}") {
      const top = stack.pop();
      if (top !== pairs[ch]) {
        errors.push(`unbalanced "${ch}" (expected close for "${top ?? "none"}")`);
        return false;
      }
    }
  }
  if (stack.length > 0) {
    errors.push(`unclosed ${stack.join(", ")}`);
    return false;
  }
  return true;
}

function checkMarkupBalance(content: string, errors: string[], isJsx: boolean): boolean {
  // Tag balance for non-void elements. JSX self-closing allowed.
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content)) !== null) {
    const closing = m[0]!.startsWith("</");
    const name = m[1]!.toLowerCase();
    if (voidTags.has(name)) continue;
    if (closing) {
      const top = stack.pop();
      if (top !== name) {
        if (top !== undefined) errors.push(`mismatched </${name}> (expected </${top}>)`);
        else errors.push(`stray </${name}>`);
        return false;
      }
    } else if (!m[2]!.endsWith("/")) {
      stack.push(name);
    }
  }
  if (stack.length > 0) {
    errors.push(`unclosed tags: ${stack.join(", ")}`);
    return false;
  }
  void isJsx;
  return true;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

function a11ySignals(content: string, kind: Artifact["kind"]): EvidenceSignal[] {
  if (kind !== "html" && kind !== "jsx" && kind !== "tsx") return [];
  const out: EvidenceSignal[] = [];
  const hasLang = /<html[^>]+lang=/i.test(content);
  out.push({ id: "a11y-lang", kind: "a11y", label: "html lang attribute", value: hasLang ? 1 : 0, detail: hasLang ? "present" : "missing" });

  const imgs = content.match(/<img\b[^>]*>/gi) ?? [];
  const total = imgs.length;
  const cov = total === 0 ? 1 : imgs.filter((t) => /\balt\s*=\s*["'][^"']+["']/i.test(t)).length / total;
  out.push({ id: "a11y-alt", kind: "a11y", label: "image alt text coverage", value: cov, detail: `${(cov * 100).toFixed(0)}% of ${total} images`, references: total > 0 ? ["a11y-lang"] : undefined });

  const landmarks = (content.match(/<(header|nav|main|section|article|aside|footer)\b/gi) ?? []).length;
  out.push({ id: "a11y-landmarks", kind: "a11y", label: "semantic landmarks", value: clamp01(landmarks / 3), detail: `${landmarks} landmark elements` });

  const hasAria = /\b(aria-label|aria-labelledby|role=)/i.test(content);
  out.push({ id: "a11y-aria", kind: "a11y", label: "aria labeling", value: hasAria ? 1 : 0.5, detail: hasAria ? "aria attributes present" : "no aria attributes" });

  const hasButton = /<button\b/i.test(content);
  const hasRoleButton = /role=["']button["']/i.test(content);
  out.push({ id: "a11y-button", kind: "a11y", label: "button semantics", value: hasButton ? 1 : hasRoleButton ? 0.7 : 0, detail: hasButton ? "native buttons" : hasRoleButton ? "role=button only" : "no buttons" });

  return out;
}

function responsiveSignals(content: string, kind: Artifact["kind"], metrics: ArtifactMetrics): EvidenceSignal[] {
  if (kind !== "html" && kind !== "jsx" && kind !== "tsx" && kind !== "css") return [];
  const out: EvidenceSignal[] = [];
  out.push({ id: "resp-viewport", kind: "responsive", label: "viewport meta", value: metrics.hasViewportMeta ? 1 : 0, detail: metrics.hasViewportMeta ? "present" : "missing" });
  out.push({ id: "resp-mediaqueries", kind: "responsive", label: "media queries", value: clamp01(metrics.mediaQueryCount / 2), detail: `${metrics.mediaQueryCount} media queries` });
  const fluidUnits = (content.match(/\b\d+(\.\d+)?(vw|vh|vmin|vmax|rem|em|%)\b/g) ?? []).length;
  out.push({ id: "resp-fluid", kind: "responsive", label: "fluid units", value: clamp01(fluidUnits / 5), detail: `${fluidUnits} fluid unit usages` });
  const hasFlexGrid = /display\s*:\s*(flex|grid)/i.test(content);
  out.push({ id: "resp-layout", kind: "responsive", label: "flex/grid layout", value: hasFlexGrid ? 1 : 0.4, detail: hasFlexGrid ? "flex/grid used" : "no flex/grid" });
  return out;
}

function performanceSignals(metrics: ArtifactMetrics): EvidenceSignal[] {
  const out: EvidenceSignal[] = [];
  const bundleScore = clamp01(1 - metrics.estimatedBundleKb / 500);
  out.push({ id: "perf-bundle", kind: "performance", label: "estimated bundle size", value: bundleScore, detail: `${metrics.estimatedBundleKb} KB estimated` });
  const animScore = clamp01(1 - metrics.animationCount / 20);
  out.push({ id: "perf-animations", kind: "performance", label: "animation density", value: animScore, detail: `${metrics.animationCount} animations` });
  const importScore = clamp01(1 - metrics.importCount / 30);
  out.push({ id: "perf-imports", kind: "performance", label: "import count", value: importScore, detail: `${metrics.importCount} imports` });
  return out;
}

function structureSignals(content: string, kind: Artifact["kind"], metrics: ArtifactMetrics, valid: boolean, parseErrors: string[]): EvidenceSignal[] {
  const out: EvidenceSignal[] = [];
  out.push({ id: "struct-valid", kind: "structure", label: "structural validity", value: valid ? 1 : 0, detail: valid ? "valid" : parseErrors[0] ?? "invalid" });
  const sizeScore = clamp01(1 - metrics.bytes / 200_000);
  out.push({ id: "struct-size", kind: "structure", label: "artifact size", value: sizeScore, detail: `${metrics.bytes} bytes` });
  const isMarkup = kind === "html" || kind === "jsx" || kind === "tsx";
  if (isMarkup) {
    const hasDoctype = /<!doctype/i.test(content);
    out.push({ id: "struct-doctype", kind: "structure", label: "doctype", value: hasDoctype ? 1 : 0.5, detail: hasDoctype ? "present" : "missing" });
    const hasLang = /<html[^>]+lang=/i.test(content);
    out.push({ id: "struct-lang", kind: "structure", label: "document language", value: hasLang ? 1 : 0.5, detail: hasLang ? "set" : "unset" });
  }
  return out;
}

function patternConformance(content: string, pattern: Pattern | undefined): PatternConformance {
  if (!pattern) return { patternId: "none", requiredPresent: [], requiredMissing: [], antiPatternsFound: [] };
  const lower = content.toLowerCase();
  const present: string[] = [];
  const missing: string[] = [];
  for (const e of pattern.requiredElements) {
    if (lower.includes(e.name.toLowerCase()) || lower.includes(e.name.replace(/-/g, " ").toLowerCase())) {
      present.push(e.name);
    } else {
      missing.push(e.name);
    }
  }
  const apFound: string[] = [];
  for (const ap of pattern.antiPatterns) {
    if (lower.includes(ap.id.toLowerCase()) || lower.includes(ap.description.toLowerCase().slice(0, 20))) {
      apFound.push(ap.id);
    }
  }
  return { patternId: pattern.id, requiredPresent: present, requiredMissing: missing, antiPatternsFound: apFound };
}

function patternSignals(conf: PatternConformance, pattern: Pattern): EvidenceSignal[] {
  const out: EvidenceSignal[] = [];
  const total = pattern.requiredElements.length;
  const presentRatio = total === 0 ? 1 : conf.requiredPresent.length / total;
  out.push({ id: "pat-required", kind: "pattern", label: "required elements present", value: presentRatio, detail: `${conf.requiredPresent.length}/${total} present`, references: ["pat-missing"] });
  out.push({ id: "pat-missing", kind: "pattern", label: "required elements missing", value: 1 - presentRatio, detail: conf.requiredMissing.length ? `missing: ${conf.requiredMissing.join(", ")}` : "none missing" });
  const apPenalty = clamp01(1 - conf.antiPatternsFound.length / Math.max(1, pattern.antiPatterns.length));
  out.push({ id: "pat-antipatterns", kind: "pattern", label: "anti-patterns present", value: apPenalty, detail: conf.antiPatternsFound.length ? `found: ${conf.antiPatternsFound.join(", ")}` : "none found" });
  return out;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
