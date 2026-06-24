import type {
  Artifact,
  Evidence,
  EvidenceSignal,
  Finding,
  Pattern,
  QualityDimension,
  Severity,
} from "../types/index.js";

/**
 * Critic rules — the deterministic, unit-tested evaluation layer. Each rule:
 *   - reads evidence + artifact (+ optional pattern)
 *   - returns a sub-score 0..1 for its dimension
 *   - emits findings (strengths/weaknesses/etc.)
 *
 * 30+ concrete rules across the 14 dimensions. Measurable dimensions derive
 * from evidence; qualitative dimensions derive from content heuristics.
 */

export interface RuleContext {
  artifact: Artifact;
  evidence: Evidence;
  pattern?: Pattern;
}

export interface RuleResult {
  ruleId: string;
  dimension: QualityDimension;
  weight: number;
  subScore: number;
  findings: Finding[];
  evidence: string[];
  note: string;
}

export interface CriticRule {
  id: string;
  dimension: QualityDimension;
  weight: number;
  description: string;
  evaluate(ctx: RuleContext): RuleResult;
}

// helpers --------------------------------------------------------------------

function sig(evidence: Evidence, id: string): EvidenceSignal | undefined {
  return evidence.signals.find((s) => s.id === id);
}

function finding(
  ruleId: string,
  dimension: QualityDimension,
  kind: Finding["kind"],
  severity: Severity,
  message: string,
  evidence?: string[],
  suggestedFix?: string,
): Finding {
  return { id: `${ruleId}:${kind}`, dimension, severity, kind, ruleId, message, evidence, suggestedFix };
}

const round = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Accessibility rules
// ---------------------------------------------------------------------------

const R_A11Y_LANG: CriticRule = {
  id: "a11y-lang",
  dimension: "accessibility",
  weight: 0.2,
  description: "Document has a lang attribute.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "a11y-lang");
    const v = s?.value ?? 0;
    const findings: Finding[] = [];
    if (v < 1) findings.push(finding("a11y-lang", "accessibility", "missing", "minor", "Missing html lang attribute for screen readers.", ["a11y-lang"], "Add lang=\"en\" to <html>."));
    return { ruleId: "a11y-lang", dimension: "accessibility", weight: 0.2, subScore: v, findings, evidence: ["a11y-lang"], note: s?.detail ?? "n/a" };
  },
};

const R_A11Y_ALT: CriticRule = {
  id: "a11y-alt",
  dimension: "accessibility",
  weight: 0.3,
  description: "Images have meaningful alt text.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "a11y-alt");
    const v = s?.value ?? 1;
    const findings: Finding[] = [];
    if (v < 1) findings.push(finding("a11y-alt", "accessibility", "weakness", "major", `Only ${(v * 100).toFixed(0)}% of images have meaningful alt text.`, ["a11y-alt"], "Add descriptive alt to every <img>."));
    return { ruleId: "a11y-alt", dimension: "accessibility", weight: 0.3, subScore: v, findings, evidence: ["a11y-alt"], note: s?.detail ?? "n/a" };
  },
};

const R_A11Y_LANDMARKS: CriticRule = {
  id: "a11y-landmarks",
  dimension: "accessibility",
  weight: 0.25,
  description: "Uses semantic landmark elements.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "a11y-landmarks");
    const v = s?.value ?? 0;
    const findings: Finding[] = [];
    if (v >= 1) findings.push(finding("a11y-landmarks", "accessibility", "strength", "info", "Good use of semantic landmarks.", ["a11y-landmarks"]));
    else findings.push(finding("a11y-landmarks", "accessibility", "weakness", "minor", "Few semantic landmark elements.", ["a11y-landmarks"], "Use header/nav/main/footer."));
    return { ruleId: "a11y-landmarks", dimension: "accessibility", weight: 0.25, subScore: v, findings, evidence: ["a11y-landmarks"], note: s?.detail ?? "n/a" };
  },
};

const R_A11Y_ARIA: CriticRule = {
  id: "a11y-aria",
  dimension: "accessibility",
  weight: 0.15,
  description: "ARIA labeling where needed.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "a11y-aria");
    const v = s?.value ?? 0.5;
    return { ruleId: "a11y-aria", dimension: "accessibility", weight: 0.15, subScore: v, findings: [], evidence: ["a11y-aria"], note: s?.detail ?? "n/a" };
  },
};

const R_A11Y_BUTTON: CriticRule = {
  id: "a11y-button",
  dimension: "accessibility",
  weight: 0.1,
  description: "Native button semantics for interactive controls.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "a11y-button");
    const v = s?.value ?? 0;
    const findings: Finding[] = [];
    if (v === 0.7) findings.push(finding("a11y-button", "accessibility", "design-issue", "minor", "Uses role=button instead of native <button>.", ["a11y-button"], "Prefer <button>."));
    return { ruleId: "a11y-button", dimension: "accessibility", weight: 0.1, subScore: v, findings, evidence: ["a11y-button"], note: s?.detail ?? "n/a" };
  },
};

// ---------------------------------------------------------------------------
// Responsiveness rules
// ---------------------------------------------------------------------------

const R_RESP_VIEWPORT: CriticRule = {
  id: "resp-viewport",
  dimension: "responsiveness",
  weight: 0.4,
  description: "Includes viewport meta tag.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "resp-viewport");
    const v = s?.value ?? 0;
    const findings: Finding[] = [];
    if (v < 1) findings.push(finding("resp-viewport", "responsiveness", "missing", "major", "Missing viewport meta tag; layout will not adapt to mobile.", ["resp-viewport"], "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">."));
    return { ruleId: "resp-viewport", dimension: "responsiveness", weight: 0.4, subScore: v, findings, evidence: ["resp-viewport"], note: s?.detail ?? "n/a" };
  },
};

const R_RESP_MQ: CriticRule = {
  id: "resp-mediaqueries",
  dimension: "responsiveness",
  weight: 0.25,
  description: "Uses media queries for breakpoints.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "resp-mediaqueries");
    const v = s?.value ?? 0;
    return { ruleId: "resp-mediaqueries", dimension: "responsiveness", weight: 0.25, subScore: v, findings: [], evidence: ["resp-mediaqueries"], note: s?.detail ?? "n/a" };
  },
};

const R_RESP_FLUID: CriticRule = {
  id: "resp-fluid",
  dimension: "responsiveness",
  weight: 0.2,
  description: "Uses fluid units (rem/vw/%).",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "resp-fluid");
    const v = s?.value ?? 0;
    return { ruleId: "resp-fluid", dimension: "responsiveness", weight: 0.2, subScore: v, findings: [], evidence: ["resp-fluid"], note: s?.detail ?? "n/a" };
  },
};

const R_RESP_LAYOUT: CriticRule = {
  id: "resp-layout",
  dimension: "responsiveness",
  weight: 0.15,
  description: "Uses flex/grid layout.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "resp-layout");
    const v = s?.value ?? 0;
    return { ruleId: "resp-layout", dimension: "responsiveness", weight: 0.15, subScore: v, findings: [], evidence: ["resp-layout"], note: s?.detail ?? "n/a" };
  },
};

// ---------------------------------------------------------------------------
// Performance rules
// ---------------------------------------------------------------------------

const R_PERF_BUNDLE: CriticRule = {
  id: "perf-bundle",
  dimension: "performance",
  weight: 0.4,
  description: "Estimated bundle size is reasonable.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "perf-bundle");
    const v = s?.value ?? 0;
    const findings: Finding[] = [];
    if (v < 0.5) findings.push(finding("perf-bundle", "performance", "tech-issue", "major", `Estimated bundle is large (${ctx.evidence.metrics.estimatedBundleKb} KB).`, ["perf-bundle"], "Code-split / tree-shake / defer heavy imports."));
    return { ruleId: "perf-bundle", dimension: "performance", weight: 0.4, subScore: v, findings, evidence: ["perf-bundle"], note: s?.detail ?? "n/a" };
  },
};

const R_PERF_ANIM: CriticRule = {
  id: "perf-animations",
  dimension: "performance",
  weight: 0.3,
  description: "Animation density is not excessive.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "perf-animations");
    const v = s?.value ?? 0;
    return { ruleId: "perf-animations", dimension: "performance", weight: 0.3, subScore: v, findings: [], evidence: ["perf-animations"], note: s?.detail ?? "n/a" };
  },
};

const R_PERF_IMPORTS: CriticRule = {
  id: "perf-imports",
  dimension: "performance",
  weight: 0.3,
  description: "Import count is controlled.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "perf-imports");
    const v = s?.value ?? 0;
    return { ruleId: "perf-imports", dimension: "performance", weight: 0.3, subScore: v, findings: [], evidence: ["perf-imports"], note: s?.detail ?? "n/a" };
  },
};

// ---------------------------------------------------------------------------
// Technical quality rules
// ---------------------------------------------------------------------------

const R_TECH_VALID: CriticRule = {
  id: "tech-valid",
  dimension: "technical-quality",
  weight: 0.5,
  description: "Artifact is structurally valid (parses).",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "struct-valid");
    const v = s?.value ?? 0;
    const findings: Finding[] = [];
    if (v < 1) findings.push(finding("tech-valid", "technical-quality", "tech-issue", "critical", `Artifact does not parse cleanly: ${ctx.evidence.parseErrors[0] ?? "invalid"}.`, ["struct-valid"], "Fix the structural errors before anything else."));
    return { ruleId: "tech-valid", dimension: "technical-quality", weight: 0.5, subScore: v, findings, evidence: ["struct-valid"], note: s?.detail ?? "n/a" };
  },
};

const R_TECH_SIZE: CriticRule = {
  id: "tech-size",
  dimension: "technical-quality",
  weight: 0.2,
  description: "Artifact size is within budget.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "struct-size");
    const v = s?.value ?? 0;
    return { ruleId: "tech-size", dimension: "technical-quality", weight: 0.2, subScore: v, findings: [], evidence: ["struct-size"], note: s?.detail ?? "n/a" };
  },
};

const R_TECH_DOCTYPE: CriticRule = {
  id: "tech-doctype",
  dimension: "technical-quality",
  weight: 0.15,
  description: "HTML documents declare a doctype.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "struct-doctype");
    const v = s?.value ?? 1;
    return { ruleId: "tech-doctype", dimension: "technical-quality", weight: 0.15, subScore: v, findings: [], evidence: ["struct-doctype"], note: s?.detail ?? "n/a" };
  },
};

const R_TECH_LANG: CriticRule = {
  id: "tech-lang",
  dimension: "technical-quality",
  weight: 0.15,
  description: "Document language is set.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "struct-lang");
    const v = s?.value ?? 1;
    return { ruleId: "tech-lang", dimension: "technical-quality", weight: 0.15, subScore: v, findings: [], evidence: ["struct-lang"], note: s?.detail ?? "n/a" };
  },
};

// ---------------------------------------------------------------------------
// Code quality & maintainability rules
// ---------------------------------------------------------------------------

const R_CODE_NAMING: CriticRule = {
  id: "code-naming",
  dimension: "code-quality",
  weight: 0.4,
  description: "Identifiers are descriptive (not single letters).",
  evaluate(ctx) {
    const content = ctx.artifact.content;
    const singles = (content.match(/\b[a-z]\b/g) ?? []).length;
    const v = clamp01(1 - singles / 50);
    const findings: Finding[] = [];
    if (v < 0.7) findings.push(finding("code-naming", "code-quality", "weakness", "minor", `${singles} single-letter tokens; prefer descriptive names.`, [], "Rename single-letter identifiers."));
    return { ruleId: "code-naming", dimension: "code-quality", weight: 0.4, subScore: v, findings, evidence: [], note: `${singles} single-letter tokens` };
  },
};

const R_CODE_MAGIC: CriticRule = {
  id: "code-magic",
  dimension: "code-quality",
  weight: 0.3,
  description: "Avoids excessive magic numbers.",
  evaluate(ctx) {
    const nums = (ctx.artifact.content.match(/\b\d{3,}\b/g) ?? []).length;
    const v = clamp01(1 - nums / 20);
    return { ruleId: "code-magic", dimension: "code-quality", weight: 0.3, subScore: v, findings: [], evidence: [], note: `${nums} large numeric literals` };
  },
};

const R_CODE_COMMENTS: CriticRule = {
  id: "code-comments",
  dimension: "code-maintainability",
  weight: 0.5,
  description: "Has explanatory structure (comments or section markers).",
  evaluate(ctx) {
    const comments = (ctx.artifact.content.match(/(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)/gm) ?? []).length;
    const v = clamp01(comments / 5);
    const findings: Finding[] = [];
    if (v < 0.3) findings.push(finding("code-comments", "code-maintainability", "opportunity", "minor", "Little explanatory commentary.", [], "Add comments for non-obvious logic."));
    return { ruleId: "code-comments", dimension: "code-maintainability", weight: 0.5, subScore: v, findings, evidence: [], note: `${comments} comments` };
  },
};

const R_CODE_MODULAR: CriticRule = {
  id: "code-modular",
  dimension: "code-maintainability",
  weight: 0.5,
  description: "Shows modular structure (imports/functions/classes).",
  evaluate(ctx) {
    const imports = ctx.evidence.metrics.importCount;
    const fns = (ctx.artifact.content.match(/(function\s+\w+|const\s+\w+\s*=\s*(\([^)]*\)|async)|class\s+\w+)/g) ?? []).length;
    const v = clamp01((imports + fns) / 6);
    return { ruleId: "code-modular", dimension: "code-maintainability", weight: 0.5, subScore: v, findings: [], evidence: [], note: `${imports} imports, ${fns} units` };
  },
};

// ---------------------------------------------------------------------------
// Pattern conformance rules
// ---------------------------------------------------------------------------

const R_PAT_REQUIRED: CriticRule = {
  id: "pat-required",
  dimension: "industry-best-practices",
  weight: 0.6,
  description: "Implements pattern required elements.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "pat-required");
    const v = s?.value ?? 1;
    const missing = ctx.evidence.patternConformance.requiredMissing;
    const findings: Finding[] = [];
    for (const m of missing) findings.push(finding("pat-required", "industry-best-practices", "missing", "major", `Missing required element: ${m}.`, ["pat-required", "pat-missing"], `Add the "${m}" element per the pattern.`));
    return { ruleId: "pat-required", dimension: "industry-best-practices", weight: 0.6, subScore: v, findings, evidence: ["pat-required"], note: s?.detail ?? "n/a" };
  },
};

const R_PAT_ANTI: CriticRule = {
  id: "pat-antipatterns",
  dimension: "industry-best-practices",
  weight: 0.4,
  description: "Avoids pattern anti-patterns.",
  evaluate(ctx) {
    const s = sig(ctx.evidence, "pat-antipatterns");
    const v = s?.value ?? 1;
    const found = ctx.evidence.patternConformance.antiPatternsFound;
    const findings: Finding[] = [];
    for (const a of found) findings.push(finding("pat-antipatterns", "industry-best-practices", "design-issue", "major", `Anti-pattern present: ${a}.`, ["pat-antipatterns"], `Remove the "${a}" anti-pattern.`));
    return { ruleId: "pat-antipatterns", dimension: "industry-best-practices", weight: 0.4, subScore: v, findings, evidence: ["pat-antipatterns"], note: s?.detail ?? "n/a" };
  },
};

// ---------------------------------------------------------------------------
// Visual / design / UX rules (heuristic; LLM reasoning augments these)
// ---------------------------------------------------------------------------

const R_VIS_HIERARCHY: CriticRule = {
  id: "vis-hierarchy",
  dimension: "visual-impact",
  weight: 0.5,
  description: "Shows visual hierarchy (headings / varied sizing).",
  evaluate(ctx) {
    const headings = (ctx.artifact.content.match(/<h[1-6]\b/gi) ?? []).length;
    const fontSizes = (ctx.artifact.content.match(/font-size\s*:/gi) ?? []).length;
    const v = clamp01((headings + fontSizes) / 4);
    const findings: Finding[] = [];
    if (v < 0.5) findings.push(finding("vis-hierarchy", "visual-impact", "weakness", "major", "Weak visual hierarchy: few heading levels / size variations.", [], "Establish h1→h3 hierarchy and size scale."));
    return { ruleId: "vis-hierarchy", dimension: "visual-impact", weight: 0.5, subScore: v, findings, evidence: [], note: `${headings} headings, ${fontSizes} font-sizes` };
  },
};

const R_VIS_COLOR: CriticRule = {
  id: "vis-color",
  dimension: "visual-impact",
  weight: 0.3,
  description: "Uses a defined color palette (CSS vars / theme).",
  evaluate(ctx) {
    const hasVars = /(--[a-z][a-z0-9-]*\s*:|@property|theme)/i.test(ctx.artifact.content);
    const colorCount = (ctx.artifact.content.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
    const v = hasVars ? clamp01(0.6 + colorCount / 20) : clamp01(colorCount / 10);
    return { ruleId: "vis-color", dimension: "visual-impact", weight: 0.3, subScore: v, findings: [], evidence: [], note: hasVars ? "CSS vars present" : `${colorCount} hex colors` };
  },
};

const R_VIS_WHITESPACE: CriticRule = {
  id: "vis-whitespace",
  dimension: "visual-impact",
  weight: 0.2,
  description: "Uses spacing/padding (whitespace).",
  evaluate(ctx) {
    const pad = (ctx.artifact.content.match(/padding\s*:/gi) ?? []).length;
    const margin = (ctx.artifact.content.match(/margin\s*:/gi) ?? []).length;
    const v = clamp01((pad + margin) / 6);
    return { ruleId: "vis-whitespace", dimension: "visual-impact", weight: 0.2, subScore: v, findings: [], evidence: [], note: `${pad + margin} spacing rules` };
  },
};

const R_CONS_FONT: CriticRule = {
  id: "cons-font",
  dimension: "design-consistency",
  weight: 0.5,
  description: "Uses a consistent font family.",
  evaluate(ctx) {
    const fonts = new Set((ctx.artifact.content.match(/font-family\s*:\s*([^;]+)/gi) ?? []).map((f) => f.toLowerCase()));
    const v = fonts.size === 0 ? 0.4 : clamp01(1 - (fonts.size - 1) / 3);
    const findings: Finding[] = [];
    if (fonts.size > 2) findings.push(finding("cons-font", "design-consistency", "design-issue", "minor", `${fonts.size} different font-family declarations; consolidate.`, [], "Use 1-2 font families."));
    return { ruleId: "cons-font", dimension: "design-consistency", weight: 0.5, subScore: v, findings, evidence: [], note: `${fonts.size} font families` };
  },
};

const R_CONS_SPACING: CriticRule = {
  id: "cons-spacing",
  dimension: "design-consistency",
  weight: 0.5,
  description: "Uses a consistent spacing scale.",
  evaluate(ctx) {
    const vals = (ctx.artifact.content.match(/(?:padding|margin|gap)\s*:\s*([^;]+)/gi) ?? []).map((v) => v.trim());
    const unique = new Set(vals.map((v) => v.replace(/^.*:\s*/, "")));
    const v = clamp01(1 - (unique.size - 3) / 10);
    return { ruleId: "cons-spacing", dimension: "design-consistency", weight: 0.5, subScore: v, findings: [], evidence: [], note: `${unique.size} unique spacing values` };
  },
};

const R_READ_CONTRAST: CriticRule = {
  id: "read-contrast",
  dimension: "readability",
  weight: 0.4,
  description: "Likely sufficient text contrast (color usage).",
  evaluate(ctx) {
    const colors = (ctx.artifact.content.match(/color\s*:/gi) ?? []).length;
    const bgs = (ctx.artifact.content.match(/background/i) ?? []).length;
    const v = clamp01(0.4 + (colors + bgs) / 20);
    return { ruleId: "read-contrast", dimension: "readability", weight: 0.4, subScore: v, findings: [], evidence: [], note: `${colors} color, ${bgs} background rules` };
  },
};

const R_READ_LINE: CriticRule = {
  id: "read-line-length",
  dimension: "readability",
  weight: 0.3,
  description: "Constrains line length (max-width).",
  evaluate(ctx) {
    const has = /max-width\s*:/i.test(ctx.artifact.content);
    const v = has ? 1 : 0.5;
    return { ruleId: "read-line-length", dimension: "readability", weight: 0.3, subScore: v, findings: [], evidence: [], note: has ? "max-width present" : "no max-width" };
  },
};

const R_READ_TYPE: CriticRule = {
  id: "read-type-scale",
  dimension: "readability",
  weight: 0.3,
  description: "Uses a typographic scale (line-height / font-size).",
  evaluate(ctx) {
    const lh = /line-height\s*:/i.test(ctx.artifact.content);
    const v = lh ? 1 : 0.6;
    return { ruleId: "read-type-scale", dimension: "readability", weight: 0.3, subScore: v, findings: [], evidence: [], note: lh ? "line-height set" : "no line-height" };
  },
};

const R_ANIM_PRESENT: CriticRule = {
  id: "anim-present",
  dimension: "animation-quality",
  weight: 0.5,
  description: "Has animation/transitions where appropriate.",
  evaluate(ctx) {
    const a = ctx.evidence.metrics.animationCount;
    const trans = (ctx.artifact.content.match(/transition\s*:/gi) ?? []).length;
    const v = clamp01((a + trans) / 4);
    const findings: Finding[] = [];
    if (v < 0.3) findings.push(finding("anim-present", "animation-quality", "opportunity", "minor", "No animations/transitions; motion could improve perceived quality.", [], "Add subtle transitions on interactive elements."));
    return { ruleId: "anim-present", dimension: "animation-quality", weight: 0.5, subScore: v, findings, evidence: [], note: `${a} anims, ${trans} transitions` };
  },
};

const R_ANIM_PERF: CriticRule = {
  id: "anim-perf",
  dimension: "animation-quality",
  weight: 0.5,
  description: "Uses transform/opacity (GPU-friendly) for motion.",
  evaluate(ctx) {
    const gpu = (ctx.artifact.content.match(/transform\s*:/gi) ?? []).length + (ctx.artifact.content.match(/opacity\s*:/gi) ?? []).length;
    const v = clamp01(gpu / 4);
    const findings: Finding[] = [];
    if (gpu === 0 && ctx.evidence.metrics.animationCount > 0) findings.push(finding("anim-perf", "animation-quality", "tech-issue", "minor", "Animations present but none use transform/opacity (may cause reflow).", [], "Animate transform/opacity, not top/left/width."));
    return { ruleId: "anim-perf", dimension: "animation-quality", weight: 0.5, subScore: v, findings, evidence: [], note: `${gpu} GPU-friendly props` };
  },
};

const R_UX_FEEDBACK: CriticRule = {
  id: "ux-feedback",
  dimension: "user-experience",
  weight: 0.5,
  description: "Interactive elements show feedback (hover/focus).",
  evaluate(ctx) {
    const hover = /:hover/gi.test(ctx.artifact.content);
    const focus = /:focus/gi.test(ctx.artifact.content);
    const v = (hover ? 0.5 : 0) + (focus ? 0.5 : 0);
    const findings: Finding[] = [];
    if (!focus) findings.push(finding("ux-feedback", "user-experience", "missing", "major", "No :focus styles; keyboard users get no visible focus.", [], "Add :focus-visible styles."));
    return { ruleId: "ux-feedback", dimension: "user-experience", weight: 0.5, subScore: v, findings, evidence: [], note: `hover=${hover}, focus=${focus}` };
  },
};

const R_UX_CTA: CriticRule = {
  id: "ux-cta",
  dimension: "user-experience",
  weight: 0.5,
  description: "Has a clear call-to-action / primary action.",
  evaluate(ctx) {
    const cta = /<(button|a)\b[^>]*(?:cta|primary|submit)/gi.test(ctx.artifact.content);
    const v = cta ? 1 : 0.5;
    return { ruleId: "ux-cta", dimension: "user-experience", weight: 0.5, subScore: v, findings: [], evidence: [], note: cta ? "CTA present" : "no obvious CTA" };
  },
};

const R_ORIG_NOVELTY: CriticRule = {
  id: "orig-novelty",
  dimension: "creative-originality",
  weight: 1.0,
  description: "Not a bare template; shows creative intent.",
  evaluate(ctx) {
    const content = ctx.artifact.content;
    const richness = ctx.evidence.metrics.elementCount + ctx.evidence.metrics.animationCount;
    const v = clamp01(richness / 25);
    const findings: Finding[] = [];
    if (v < 0.4) findings.push(finding("orig-novelty", "creative-originality", "weakness", "minor", "Output reads as a bare scaffold; add distinctive creative elements.", [], "Add signature visual/motion elements."));
    return { ruleId: "orig-novelty", dimension: "creative-originality", weight: 1.0, subScore: v, findings, evidence: [], note: `richness ${richness}` };
  },
};

const R_MODERN_FLUID: CriticRule = {
  id: "modern-fluid",
  dimension: "modern-design-practices",
  weight: 0.5,
  description: "Uses modern layout (grid/flex/gap) over floats/tables.",
  evaluate(ctx) {
    const modern = /display\s*:\s*(flex|grid)|\bgap\s*:/gi.test(ctx.artifact.content);
    const legacy = /float\s*:/i.test(ctx.artifact.content);
    const v = (modern ? 0.7 : 0.2) + (legacy ? -0.3 : 0.3);
    return { ruleId: "modern-fluid", dimension: "modern-design-practices", weight: 0.5, subScore: clamp01(v), findings: [], evidence: [], note: `modern=${modern}, legacy=${legacy}` };
  },
};

const R_MODERN_VARS: CriticRule = {
  id: "modern-vars",
  dimension: "modern-design-practices",
  weight: 0.5,
  description: "Uses CSS custom properties / design tokens.",
  evaluate(ctx) {
    const has = /--[a-z]/i.test(ctx.artifact.content);
    const v = has ? 1 : 0.4;
    return { ruleId: "modern-vars", dimension: "modern-design-practices", weight: 0.5, subScore: v, findings: [], evidence: [], note: has ? "CSS vars present" : "no CSS vars" };
  },
};

export const CRITIC_RULES: CriticRule[] = [
  R_A11Y_LANG, R_A11Y_ALT, R_A11Y_LANDMARKS, R_A11Y_ARIA, R_A11Y_BUTTON,
  R_RESP_VIEWPORT, R_RESP_MQ, R_RESP_FLUID, R_RESP_LAYOUT,
  R_PERF_BUNDLE, R_PERF_ANIM, R_PERF_IMPORTS,
  R_TECH_VALID, R_TECH_SIZE, R_TECH_DOCTYPE, R_TECH_LANG,
  R_CODE_NAMING, R_CODE_MAGIC, R_CODE_COMMENTS, R_CODE_MODULAR,
  R_PAT_REQUIRED, R_PAT_ANTI,
  R_VIS_HIERARCHY, R_VIS_COLOR, R_VIS_WHITESPACE,
  R_CONS_FONT, R_CONS_SPACING,
  R_READ_CONTRAST, R_READ_LINE, R_READ_TYPE,
  R_ANIM_PRESENT, R_ANIM_PERF,
  R_UX_FEEDBACK, R_UX_CTA,
  R_ORIG_NOVELTY,
  R_MODERN_FLUID, R_MODERN_VARS,
];

export function runRules(ctx: RuleContext): RuleResult[] {
  return CRITIC_RULES.map((r) => r.evaluate(ctx));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export { round };
