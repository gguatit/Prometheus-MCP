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
  signals.push(...graphicsSignals(content, artifact.kind, metrics));
  signals.push(...gameFeelSignals(content, artifact.kind, metrics));

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

  // --- 3D / graphics metrics ---
  const useFrameCount = (content.match(/\buseFrame\b/g) ?? []).length;
  const useThreeCount = (content.match(/\buseThree\b/g) ?? []).length;
  const shaderCount =
    (content.match(/shaderMaterial\b/gi) ?? []).length +
    (content.match(/ShaderMaterial\b/g) ?? []).length +
    (content.match(/createShaderModule\b/g) ?? []).length +
    (content.match(/gl\.createShader\b/g) ?? []).length;
  const disposeCallCount = (content.match(/\.dispose\s*\(/g) ?? []).length;
  const bufferGeometryCount =
    (content.match(/bufferGeometry\b/gi) ?? []).length +
    (content.match(/BufferGeometry\b/g) ?? []).length;
  const postProcessingCount =
    (content.match(/EffectComposer\b/g) ?? []).length +
    (content.match(/UnrealBloomPass\b/g) ?? []).length +
    (content.match(/RenderPass\b/g) ?? []).length +
    (content.match(/postprocessing\b/gi) ?? []).length;
  const instancedMeshCount =
    (content.match(/InstancedMesh\b/g) ?? []).length +
    (content.match(/instancedMesh\b/gi) ?? []).length;
  const additiveBlendingCount = (content.match(/AdditiveBlending\b/g) ?? []).length;
  const webgpuInitCount =
    (content.match(/navigator\.gpu\b/g) ?? []).length +
    (content.match(/requestAdapter\b/g) ?? []).length +
    (content.match(/getContext\s*\(\s*['"]webgpu['"]/g) ?? []).length;
  // `new THREE.*` or `new Vector3` etc. inside useFrame/RAF callback — GC pressure
  const newInLoopCount = countNewInLoop(content);
  // delta-based motion: R3F useFrame((state, delta) => ...) OR vanilla Three.js clock.getDelta() + * delta
  const deltaUsageCount =
    (content.match(/useFrame\s*\(\s*\([^)]*\bdelta\b[^)]*\)/g) ?? []).length +
    (content.match(/\bgetDelta\s*\(/g) ?? []).length +
    (content.match(/\*\s*delta\b/g) ?? []).length;
  const inputHandlerCount =
    (content.match(/\bon(KeyDown|KeyUp|MouseDown|MouseUp|MouseMove|Click|PointerDown|PointerUp|PointerMove)\b/g) ?? []).length +
    (content.match(/addEventListener\s*\(\s*['"](keydown|keyup|mousedown|mouseup|mousemove|click|pointerdown|pointerup|pointermove)['"]/g) ?? []).length;
  const screenShakeCount =
    (content.match(/screenShake\b/gi) ?? []).length +
    (content.match(/camera\.shake\b/gi) ?? []).length +
    (content.match(/shake\b/gi) ?? []).length;

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
    useFrameCount,
    useThreeCount,
    shaderCount,
    disposeCallCount,
    bufferGeometryCount,
    postProcessingCount,
    instancedMeshCount,
    additiveBlendingCount,
    webgpuInitCount,
    newInLoopCount,
    deltaUsageCount,
    inputHandlerCount,
    screenShakeCount,
  };
}

/**
 * Detect `new THREE.X(...)` or `new Vector3(...)` etc. inside useFrame or
 * requestAnimationFrame callback bodies. This is the #1 R3F/Three.js GC
 * anti-pattern. We approximate by finding the callback body region and
 * counting `new` keyword occurrences that construct 3D types.
 */
function countNewInLoop(content: string): number {
  let count = 0;
  // match useFrame((state, delta) => { ... }) or useFrame(() => { ... }) bodies
  const frameRe = /useFrame\s*\(\s*(?:\([^)]*\)\s*=>|function\s*\([^)]*\)\s*)\s*\{/g;
  let fm: RegExpExecArray | null;
  while ((fm = frameRe.exec(content)) !== null) {
    const body = extractBraceBody(content, fm.index + fm[0].length - 1);
    if (body) count += (body.match(/new\s+[A-Z][A-Za-z0-9_.]*(?:Vector3|Vector2|Matrix4|Matrix3|Quaternion|Color|Euler|Vector3d|THREE\.[A-Z])/g) ?? []).length;
  }
  // match requestAnimationFrame(animate) → animate() { ... }
  const rafRe = /requestAnimationFrame\s*\(\s*(\w+)\s*\)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rafRe.exec(content)) !== null) {
    const fnName = rm[1]!;
    const fnRe = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`, "g");
    let fnm: RegExpExecArray | null;
    while ((fnm = fnRe.exec(content)) !== null) {
      const body = extractBraceBody(content, fnm.index + fnm[0].length - 1);
      if (body) count += (body.match(/new\s+[A-Z][A-Za-z0-9_.]*(?:Vector3|Vector2|Matrix4|Matrix3|Quaternion|Color|Euler|THREE\.[A-Z])/g) ?? []).length;
    }
  }
  return count;
}

/** Extract a balanced `{...}` body starting at the `{` at position `start`. */
function extractBraceBody(content: string, start: number): string | null {
  if (content[start] !== "{") return null;
  let depth = 0;
  let inString: string | null = null;
  for (let i = start; i < content.length; i++) {
    const ch = content[i]!;
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return content.slice(start + 1, i);
    }
  }
  return null;
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
  // CDATA-style raw-text elements: their content is NOT parsed as HTML.
  // <script> and <style> bodies contain JS/CSS where `<` is comparison, not a tag.
  const rawTextTags = new Set(["script", "style", "textarea", "title"]);
  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content)) !== null) {
    // Skip TypeScript generics in JSX/TSX: <Foo> immediately preceded by identifier char or ')' (e.g. useRef<T>, Array<T>, fn()<T>)
    // Generics never have whitespace before '<'; JSX tags always do (return <mesh>, => <div>).
    if (isJsx && m.index > 0) {
      const prev = content[m.index - 1];
      if (prev && (/[a-zA-Z0-9_$]/.test(prev) || prev === ")")) continue;
    }
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
      // For raw-text elements (script/style/textarea/title), skip the body entirely.
      // Find the matching closing tag and jump past it — content between is NOT HTML.
      if (rawTextTags.has(name)) {
        const closeRe = new RegExp(`</${name}\\s*>`, "gi");
        closeRe.lastIndex = tagRe.lastIndex;
        const closeM = closeRe.exec(content);
        if (closeM) {
          // Pop the element we just pushed — its closing tag will be skipped, not re-parsed.
          stack.pop();
          tagRe.lastIndex = closeRe.lastIndex;
          continue;
        }
        // No closing tag found — let the normal flow report it as unclosed.
      }
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
    const nameLower = e.name.toLowerCase();
    const nameNoDash = e.name.replace(/-/g, " ").toLowerCase();
    const nameNoSep = e.name.replace(/-/g, "").toLowerCase();
    if (lower.includes(nameLower) || lower.includes(nameNoDash) || lower.includes(nameNoSep)) {
      present.push(e.name);
    } else {
      missing.push(e.name);
    }
  }
  const apFound: string[] = [];
  for (const ap of pattern.antiPatterns) {
    const apIdLower = ap.id.toLowerCase();
    const apIdNoSep = ap.id.replace(/-/g, "").toLowerCase();
    const apDesc = ap.description.toLowerCase().slice(0, 20);
    if (lower.includes(apIdLower) || lower.includes(apIdNoSep) || lower.includes(apDesc)) {
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

// ---------------------------------------------------------------------------
// Graphics / 3D signals (Three.js / R3F / WebGL / WebGPU / shaders)
// ---------------------------------------------------------------------------

/** Detect whether content (e.g. HTML) contains 3D/graphics code worth evaluating. */
function hasGraphicsMarkers(content: string): boolean {
  return /\b(THREE\.|WebGLRenderer|WebGL2|EffectComposer|UnrealBloomPass|RenderPass|BufferGeometry|ShaderMaterial|createShaderModule|navigator\.gpu|requestAdapter|getContext\s*\(\s*['"]webgpu|gl\.createShader|AdditiveBlending|useFrame|useThree|InstancedMesh|postprocessing|FogExp2|ACESFilmicToneMapping|OrbitControls|GLCube|attribute\s+vec3|uniform\s+mat4|void\s+main\s*\()\b/i.test(content);
}

function graphicsSignals(content: string, kind: Artifact["kind"], metrics: ArtifactMetrics): EvidenceSignal[] {
  // Fire for JS/TS/JSX/TSX unconditionally; fire for HTML/CSS only when 3D markers are present
  // (a Three.js demo wrapped in HTML has all the 3D code inside <script> tags).
  if (kind !== "js" && kind !== "ts" && kind !== "jsx" && kind !== "tsx") {
    if (!hasGraphicsMarkers(content)) return [];
  }
  const out: EvidenceSignal[] = [];
  const lower = content.toLowerCase();

  // dispose — cleanup of geometry/material/texture. Critical for long-running 3D apps.
  const hasDispose = metrics.disposeCallCount > 0;
  const disposeScore = metrics.disposeCallCount === 0 ? 0 : clamp01(metrics.disposeCallCount / 3);
  out.push({ id: "gfx-dispose", kind: "graphics", label: "GPU resource disposal", value: disposeScore, detail: hasDispose ? `${metrics.disposeCallCount} dispose() calls` : "no dispose() calls — GPU leak risk" });

  // context loss handling — WebGL context lost/restored events
  const hasContextLoss = /contextlost|contextrestored|WEBGL_lose_context/i.test(content);
  out.push({ id: "gfx-context-loss", kind: "graphics", label: "context loss handling", value: hasContextLoss ? 1 : 0.3, detail: hasContextLoss ? "context loss handled" : "no context loss handling" });

  // draw calls / renderer.info awareness
  const hasDrawCallAwareness = /renderer\.info|render\.calls|drawCalls|draw_calls/i.test(content);
  out.push({ id: "gfx-draw-calls", kind: "graphics", label: "draw call awareness", value: hasDrawCallAwareness ? 1 : 0.5, detail: hasDrawCallAwareness ? "monitors renderer.info" : "no draw call monitoring" });

  // buffer geometry usage — proper BufferGeometry not legacy Geometry
  const hasBufferGeo = metrics.bufferGeometryCount > 0;
  out.push({ id: "gfx-buffer-usage", kind: "graphics", label: "BufferGeometry usage", value: hasBufferGeo ? 1 : 0.4, detail: hasBufferGeo ? `${metrics.bufferGeometryCount} BufferGeometry refs` : "no BufferGeometry — may use legacy geometry" });

  // post-processing — EffectComposer / bloom / etc.
  const ppScore = metrics.postProcessingCount === 0 ? 0.3 : clamp01(metrics.postProcessingCount / 3);
  out.push({ id: "gfx-postprocessing", kind: "graphics", label: "post-processing", value: ppScore, detail: `${metrics.postProcessingCount} post-processing refs` });

  // WebGPU initialization — proper adapter→device→configure flow
  const hasWebgpuInit = metrics.webgpuInitCount >= 2 && /requestDevice|configure\b/i.test(content);
  const hasWebgpuGuard = /navigator\.gpu\s*\?\s*\./i.test(content) || /if\s*\(\s*!?navigator\.gpu/i.test(content);
  out.push({ id: "gfx-webgpu-init", kind: "graphics", label: "WebGPU init", value: hasWebgpuInit ? (hasWebgpuGuard ? 1 : 0.7) : 0, detail: hasWebgpuInit ? (hasWebgpuGuard ? "proper init + null guard" : "init without null guard") : "no WebGPU init" });

  // instancing — InstancedMesh for batched draws
  const instancingScore = metrics.instancedMeshCount === 0 ? 0.4 : clamp01(metrics.instancedMeshCount / 2);
  out.push({ id: "gfx-instancing", kind: "graphics", label: "instancing", value: instancingScore, detail: `${metrics.instancedMeshCount} InstancedMesh refs` });

  // frustum culling awareness
  const hasFrustumCull = /frustumCulled|Frustum/i.test(content);
  out.push({ id: "gfx-frustum-cull", kind: "graphics", label: "frustum culling", value: hasFrustumCull ? 1 : 0.5, detail: hasFrustumCull ? "frustum culling present" : "no explicit frustum culling" });

  // shader balance — GLSL/WGSL brace balance in template strings
  const shaderBalanceScore = checkShaderBalance(content);
  out.push({ id: "gfx-shader-balance", kind: "graphics", label: "shader brace balance", value: shaderBalanceScore.value, detail: shaderBalanceScore.detail });

  // additive blending (for VFX patterns)
  const hasAdditive = metrics.additiveBlendingCount > 0;
  const lowerHasAdditive = lower.includes("additiveblending");
  void lowerHasAdditive;
  out.push({ id: "gfx-additive-blending", kind: "graphics", label: "additive blending", value: hasAdditive ? 1 : 0.5, detail: hasAdditive ? `${metrics.additiveBlendingCount} additive blending refs` : "no additive blending" });

  return out;
}

/** Check GLSL/WGSL shader code brace balance inside template literals. */
function checkShaderBalance(content: string): { value: number; detail: string } {
  // Extract template literal contents that look like shaders (contain void main, fn main, uniform, varying, attribute)
  const tmplRe = /`(?:[^`\\]|\\.)*`/g;
  let m: RegExpExecArray | null;
  const shaders: string[] = [];
  while ((m = tmplRe.exec(content)) !== null) {
    const body = m[0]!.slice(1, -1);
    if (/\b(void\s+main|fn\s+main|uniform\b|varying\b|attribute\b|@vertex|@fragment)/i.test(body)) {
      shaders.push(body);
    }
  }
  if (shaders.length === 0) return { value: 0.5, detail: "no shader template strings detected" };
  let allBalanced = true;
  for (const s of shaders) {
    let depth = 0;
    for (const ch of s) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth < 0) { allBalanced = false; break; }
    }
    if (depth !== 0) allBalanced = false;
  }
  return { value: allBalanced ? 1 : 0, detail: allBalanced ? `${shaders.length} shaders balanced` : `${shaders.length} shaders, brace imbalance detected` };
}

// ---------------------------------------------------------------------------
// Game feel signals (juice, input, feedback, timing)
// ---------------------------------------------------------------------------

function gameFeelSignals(content: string, kind: Artifact["kind"], metrics: ArtifactMetrics): EvidenceSignal[] {
  // Fire for JS/TS/JSX/TSX unconditionally; fire for HTML only when game/3D markers are present.
  if (kind !== "js" && kind !== "ts" && kind !== "jsx" && kind !== "tsx") {
    if (!hasGraphicsMarkers(content)) return [];
  }
  const out: EvidenceSignal[] = [];

  // input handling — keyboard/mouse/pointer/touch
  const inputScore = metrics.inputHandlerCount === 0 ? 0.2 : clamp01(metrics.inputHandlerCount / 4);
  out.push({ id: "feel-input", kind: "game-feel", label: "input handling", value: inputScore, detail: `${metrics.inputHandlerCount} input handlers` });

  // screen shake / camera shake — juice indicator
  const shakeScore = metrics.screenShakeCount === 0 ? 0.3 : clamp01(metrics.screenShakeCount / 2);
  out.push({ id: "feel-screen-shake", kind: "game-feel", label: "screen shake", value: shakeScore, detail: `${metrics.screenShakeCount} shake refs` });

  // hit feedback — particles/flash/impact on collision or hit
  const hasHitFeedback = /hit\b|impact|flash|explosion|burst|spark/i.test(content);
  out.push({ id: "feel-hit-feedback", kind: "game-feel", label: "hit feedback", value: hasHitFeedback ? 1 : 0.3, detail: hasHitFeedback ? "hit feedback present" : "no hit feedback" });

  // delta-based motion — useFrame delta or delta time for framerate independence
  const deltaScore = metrics.deltaUsageCount > 0 ? 1 : 0.4;
  out.push({ id: "feel-delta-motion", kind: "game-feel", label: "framerate-independent motion", value: deltaScore, detail: metrics.deltaUsageCount > 0 ? `${metrics.deltaUsageCount} delta usages` : "no delta-based motion — frame-dependent" });

  // anticipation / easing — tweening, easing functions, anticipation
  const hasEasing = /easing|easing|tween|anticipat|ease[A-Z]|cubicBezier|lerp\b|slerp\b/i.test(content);
  out.push({ id: "feel-anticipation", kind: "game-feel", label: "easing/anticipation", value: hasEasing ? 1 : 0.4, detail: hasEasing ? "easing/lerp present" : "no easing — linear motion only" });

  return out;
}
