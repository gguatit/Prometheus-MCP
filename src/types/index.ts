/**
 * Prometheus-MCP shared domain types.
 *
 * These are the canonical contracts used across all modules. MCP tool I/O is
 * additionally validated by zod schemas in `src/mcp/schemas.ts`; internal
 * records by JSON Schema in `src/infrastructure/schemas.ts`. Artifact validity
 * is checked by language-aware validators, not by these schemas.
 */

// ---------------------------------------------------------------------------
// Identifiers & primitives
// ---------------------------------------------------------------------------

export type Id = string;
export type Iso8601 = string;

export type Domain =
  | "web-design"
  | "ui-design"
  | "ux-design"
  | "three-js"
  | "react-three-fiber"
  | "vfx"
  | "interactive-experience"
  | "frontend-animation"
  | "game-development"
  | "creative-coding";

export type ArtifactKind = "html" | "jsx" | "tsx" | "js" | "ts" | "css" | "json" | "text" | "markdown";

export type Severity = "info" | "minor" | "major" | "critical";
export type FindingKind =
  | "strength"
  | "weakness"
  | "missing"
  | "design-issue"
  | "tech-issue"
  | "opportunity";

export type TrustLevel = "internal" | "verified" | "community" | "untrusted";

export type ProviderId = "stub" | "openai" | "deepseek" | "minimax" | "qwen" | "glm" | "claude";

export type RegenerateScope = "full" | "surgical";
export type RecommendedNextStep = "finalize" | "regenerate" | "research" | "reselect" | "improve";

// ---------------------------------------------------------------------------
// Quality dimensions (the 14 required by the spec)
// ---------------------------------------------------------------------------

export type QualityDimension =
  | "visual-impact"
  | "design-consistency"
  | "readability"
  | "animation-quality"
  | "technical-quality"
  | "accessibility"
  | "responsiveness"
  | "performance"
  | "code-maintainability"
  | "code-quality"
  | "user-experience"
  | "creative-originality"
  | "modern-design-practices"
  | "industry-best-practices"
  | "graphics-quality"
  | "game-feel";

export const QUALITY_DIMENSIONS: readonly QualityDimension[] = [
  "visual-impact",
  "design-consistency",
  "readability",
  "animation-quality",
  "technical-quality",
  "accessibility",
  "responsiveness",
  "performance",
  "code-maintainability",
  "code-quality",
  "user-experience",
  "creative-originality",
  "modern-design-practices",
  "industry-best-practices",
  "graphics-quality",
  "game-feel",
] as const;

export type DimensionScores = Record<QualityDimension, number>;

// ---------------------------------------------------------------------------
// CreativeBrief & Artifact
// ---------------------------------------------------------------------------

export interface CreativeBrief {
  id: Id;
  userId?: string;
  intent: string;
  domain: Domain;
  constraints: string[];
  targetScore: number; // 0..100 aggregate target
  maxIterations: number;
  costBudgetUsd?: number;
  providerHints?: ProviderHint[];
  seedArtifact?: Artifact;
}

export interface ProviderHint {
  providerId?: ProviderId;
  requireVision?: boolean;
  requireStreaming?: boolean;
  requireStructuredOutput?: boolean;
  preferLowCost?: boolean;
}

export interface Artifact {
  id: Id;
  kind: ArtifactKind;
  content: string;
  label?: string;
  generatedAt: Iso8601;
  providerId: ProviderId;
  iteration: number;
  metadata?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Pattern library
// ---------------------------------------------------------------------------

export interface PatternElement {
  name: string;
  description: string;
  required: boolean;
}

export interface QualityRuleSpec {
  id: string;
  dimension: QualityDimension;
  description: string;
  weight: number; // within dimension, 0..1 (relative)
}

export interface AntiPatternSpec {
  id: string;
  description: string;
  dimension: QualityDimension;
}

export interface ImprovementSuggestionSpec {
  id: string;
  dimension: QualityDimension;
  description: string;
  expectedUplift: number; // 0..100
}

export interface ExampleOutput {
  label: string;
  kind: ArtifactKind;
  snippet: string;
}

export interface PatternReference {
  title: string;
  url?: string;
  author?: string;
}

export interface PatternProvenance {
  source: string;
  author?: string;
  commit?: string;
  fetchedAt: Iso8601;
  trust: TrustLevel;
}

export interface Pattern {
  id: string;
  name: string;
  description: string;
  category: string;
  domain: Domain;
  version: string; // semver
  provenance: PatternProvenance;
  requiredElements: PatternElement[];
  optionalElements: PatternElement[];
  qualityRules: QualityRuleSpec[];
  antiPatterns: AntiPatternSpec[];
  improvementSuggestions: ImprovementSuggestionSpec[];
  exampleOutputs: ExampleOutput[];
  references: PatternReference[];
}

// ---------------------------------------------------------------------------
// Evidence (deterministic facts about an artifact)
// ---------------------------------------------------------------------------

export interface Evidence {
  artifactId: Id;
  collectedAt: Iso8601;
  valid: boolean; // parsed / compiled cleanly
  parseErrors: string[];
  // measurable signals
  signals: EvidenceSignal[];
  // pattern conformance
  patternConformance: PatternConformance;
  // raw metrics
  metrics: ArtifactMetrics;
}

export interface EvidenceSignal {
  id: string;
  kind: "a11y" | "responsive" | "performance" | "structure" | "pattern" | "security" | "graphics" | "game-feel";
  label: string;
  value: number; // normalized 0..1 where 1 is good
  detail: string;
  references?: string[]; // ids of related evidence
}

export interface PatternConformance {
  patternId: string;
  requiredPresent: string[];
  requiredMissing: string[];
  antiPatternsFound: string[];
}

export interface ArtifactMetrics {
  linesOfCode: number;
  bytes: number;
  elementCount: number;
  mediaQueryCount: number;
  animationCount: number;
  importCount: number;
  hasViewportMeta: boolean;
  altTextCoverage: number; // 0..1
  semanticLandmarkCount: number;
  estimatedBundleKb: number;
  // 3D / graphics metrics
  useFrameCount: number;
  useThreeCount: number;
  shaderCount: number;
  disposeCallCount: number;
  bufferGeometryCount: number;
  postProcessingCount: number;
  instancedMeshCount: number;
  additiveBlendingCount: number;
  webgpuInitCount: number;
  newInLoopCount: number; // `new THREE.*` inside useFrame/RAF — GC pressure
  deltaUsageCount: number; // useFrame delta used for framerate-independent motion
  inputHandlerCount: number;
  screenShakeCount: number;
}

// ---------------------------------------------------------------------------
// Critique & scoring
// ---------------------------------------------------------------------------

export interface Finding {
  id: string;
  dimension: QualityDimension;
  severity: Severity;
  kind: FindingKind;
  ruleId: string;
  message: string;
  evidence?: string[]; // evidence signal ids
  suggestedFix?: string;
}

export interface ScoreContribution {
  ruleId: string;
  dimension: QualityDimension;
  delta: number; // signed contribution to the dimension score (0..100 scale)
  evidence: string[]; // evidence signal ids
  note: string;
}

export interface Suggestion {
  id: string;
  dimension: QualityDimension;
  priority: number; // 1 (highest) .. 5
  description: string;
  expectedUplift: number; // 0..100
  suggestedFix?: string;
}

export interface Critique {
  artifactId: Id;
  sessionId: Id;
  criticVersion: string;
  dimensionScores: DimensionScores;
  aggregateScore: number;
  findings: Finding[];
  suggestions: Suggestion[];
  justification: ScoreContribution[];
  expectedUpliftIfApplied: number;
  recommendedNextStep: RecommendedNextStep;
  reasoningUsed: boolean;
  createdAt: Iso8601;
}

// ---------------------------------------------------------------------------
// Improvement
// ---------------------------------------------------------------------------

export type ChangeKind = "add" | "remove" | "replace" | "refactor";

export interface PlannedChange {
  id: string;
  dimension: QualityDimension;
  findingId?: string;
  kind: ChangeKind;
  target: string; // element / selector / function / region
  description: string;
  codeSnippet?: string;
}

export interface ImprovementPlan {
  id: Id;
  critiqueId: Id;
  changes: PlannedChange[];
  strategy: string;
  targetDimensions: QualityDimension[];
  regenerateScope: RegenerateScope;
  expectedUplift: number;
}

export interface RevisionPrompt {
  systemPrompt: string;
  userPrompt: string;
  retainFromPrior: string[]; // elements to keep
  avoid: string[]; // anti-patterns to avoid
  patternId?: string;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface Capabilities {
  streaming: boolean;
  toolUse: boolean;
  structuredOutput: boolean;
  vision: boolean;
  contextWindow: number; // tokens
  supportsSystemPrompt: boolean;
}

export interface GenerationRequest {
  providerId: ProviderId;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  expectedKind: ArtifactKind;
  patternId?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface GenerationResponse {
  artifact: Artifact;
  usage: TokenUsage;
  providerId: ProviderId;
  model: string;
  finishReason: string;
}

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export type KnowledgeSourceKind = "context7" | "official-doc" | "github" | "internal-pattern" | "external-mcp";

export interface KnowledgeFragment {
  id: string;
  source: KnowledgeSourceKind;
  title: string;
  url?: string;
  content: string; // sanitized
  trust: TrustLevel;
  quarantined: boolean;
  collectedAt: Iso8601;
}

export interface SanitizationResult {
  fragment: KnowledgeFragment;
  quarantined: boolean;
  removedMarkers: string[];
}

// ---------------------------------------------------------------------------
// Session, History, Memory
// ---------------------------------------------------------------------------

export type SessionStatus = "running" | "completed" | "terminated" | "error";

export interface IterationRecord {
  index: number;
  startedAt: Iso8601;
  endedAt?: Iso8601;
  artifact?: Artifact;
  critique?: Critique;
  improvementPlan?: ImprovementPlan;
  providerId?: ProviderId;
  tokens: number;
  costUsd: number;
  deltaScore?: number;
}

export interface Session {
  id: Id;
  briefId: Id;
  status: SessionStatus;
  startedAt: Iso8601;
  endedAt?: Iso8601;
  iterations: IterationRecord[];
  finalArtifactId?: Id;
  finalScore?: number;
  totalTokens: number;
  totalCostUsd: number;
  providerUsed: ProviderId;
  patternIds: string[];
  domain?: Domain;
  terminationReason?: string;
}

export type MemoryKind =
  | "pattern-effectiveness"
  | "improvement-strategy"
  | "failure-case"
  | "quality-trend";

export interface Effectiveness {
  attempts: number;
  successes: number; // reached target / uplift > 0
  avgUplift: number;
  lastAppliedAt?: Iso8601;
}

export interface MemoryRecord {
  id: Id;
  kind: MemoryKind;
  patternCategory?: string;
  key: string;
  value: string;
  effectiveness: Effectiveness;
  createdAt: Iso8601;
  updatedAt: Iso8601;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export type SpanStatus = "ok" | "error";
export type SpanKind = "internal" | "client" | "producer" | "consumer";

export interface TelemetryEvent {
  name: string;
  atMs: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface TelemetrySpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startMs: number;
  endMs?: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  events: TelemetryEvent[];
}

export interface MetricSample {
  name: string;
  value: number;
  atMs: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface CostRecord {
  sessionId: Id;
  providerId: ProviderId;
  model: string;
  tokens: number;
  costUsd: number;
  atMs: number;
}

// ---------------------------------------------------------------------------
// Loop control
// ---------------------------------------------------------------------------

export interface TerminationPolicy {
  targetScore: number;
  maxIterations: number;
  maxCostUsd?: number;
  maxWallClockMs?: number;
  minDeltaImprovement: number;
  maxFlatIterations: number;
}

export type LoopState =
  | "plan"
  | "collect"
  | "select"
  | "enhance"
  | "generate"
  | "evidence"
  | "critique"
  | "improve"
  | "decide"
  | "finalize";

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface QualityTrendPoint {
  bucket: Iso8601;
  domain: Domain;
  avgAggregateScore: number;
  avgDimensionScores: Partial<DimensionScores>;
  sessionCount: number;
}

export interface QualityTrendReport {
  generatedAt: Iso8601;
  since: Iso8601;
  points: QualityTrendPoint[];
  topPatterns: { patternId: string; uses: number; avgUplift: number }[];
}

// ---------------------------------------------------------------------------
// Result envelope (used internally for fallible operations)
// ---------------------------------------------------------------------------

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
