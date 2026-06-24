# Prometheus-MCP — Creative Director MCP

> The AI Creative Director that turns ordinary model output into expert-grade creative work.

**Status:** Architecture (Deliverables 1–24) · **License:** MIT · **Runtime:** Node.js (ESM) · **Language:** TypeScript · **Protocol:** MCP 1.x (`@modelcontextprotocol/sdk@^1.29.0`)

---

## 1. Executive Summary

Prometheus-MCP is a Model Context Protocol server that acts as an **AI Creative Director**. It is not a documentation retrieval engine. Context7, official docs, GitHub, and external MCPs are **auxiliary** inputs; the core value comes from:

1. **Expert Pattern Library** — reusable, versioned specifications of expert creative work.
2. **Critic Engine** — auditable, evidence-based evaluation producing a full justification tree, not just a score.
3. **Improvement Engine** — structured change plans and surgical revision prompts, not naive re-prompting.
4. **Quality Intelligence** — measurement of real artifact properties (validity, accessibility, performance) combined with LLM reasoning.
5. **Auto-Improvement Loop** — a bounded state machine with feedback edges and an explicit termination policy.
6. **Long-Term Memory** — cross-session retrieval of effective improvement strategies, with bounded (reviewable) learning.

The system targets web/UI/UX design, Three.js / React Three Fiber, VFX, interactive experiences, frontend animation, game development, and creative coding. It is provider-agnostic (Claude, GPT, DeepSeek, MiniMax, Qwen, GLM, future) via a **capability-based** abstraction.

**Design horizon:** 10 years. Every swappable subsystem sits behind a repository/interface boundary so local file-backed MVP stores can become Redis/Postgres/vector/OTLP backends without touching domain logic.

---

## 2. Architecture Overview

A **state-machine pipeline with feedback edges** (not a linear chain). The Loop Controller can route back to Knowledge Collection, Pattern Selection, or Generation depending on what the Critic found.

```
CreativeBrief
   │
   ▼
Planner ─────────────────────────────────────────┐
   │                                              │
   ▼                                              │
KnowledgeCollector ──► Sanitizer ──► Normalizer  │  (feedback: "research more")
   │                                              │
   ▼                                              │
PatternSelector ◄────────────────────────────────┘  (feedback: "wrong pattern")
   │
   ▼
PromptEnhancer
   │
   ▼
Provider (generate) ──► Artifact
   │
   ▼
EvidenceCollector (static analysis / metrics / optional render+snapshot)
   │
   ▼
CriticEngine (rules + LLM reasoning over code + evidence) ──► Critique (+Scores +Justification)
   │
   ▼
ImprovementEngine ──► ImprovementPlan (structured) + RevisionPrompt
   │
   ▼
LoopController (termination policy) ──►  pass? ──► finalize
   │ fail / below target / budget remains                        │
   ▼                                                              ▼
(regenerate: full OR surgical)                              Session persisted
   │                                                              │
   └────────────────────────────────────────────────┐      Memory + History
                                                    │      Telemetry span closed
   back to: Knowledge / Pattern / Generate          │      Analytics updated
```

**Why state machine, not linear:** A linear pipeline forces every defect into a costly full regeneration. Real creative direction sometimes says "go research more" (back to Knowledge) or "wrong reference idiom" (back to Pattern), not always "regenerate". Feedback edges make this explicit and budget-aware.

---

## 3. Design Principles

1. **Opinionated surface, modular interior.** The MCP client sees ~7 high-value tools; 14 internal modules are implementation detail and may refactor without breaking clients.
2. **Evidence over opinion.** Where a quality dimension can be *measured* (validity, a11y, performance, responsiveness), it is measured with real code. LLM reasoning augments measurement; it does not replace it.
3. **Auditable by construction.** Every score contribution traces to a rule id, weight, and evidence. No black-box numbers.
4. **Untrusted external knowledge.** Content from Context7/docs/GitHub/external MCPs is *data*, never instructions. It passes a sanitization/quarantine boundary and schema validation before use.
5. **Interfaces at every swappable seam.** Patterns, memory, history, telemetry, providers, knowledge sources — all behind interfaces. MVP = in-process/file; production = distributed backends. Zero domain-logic changes.
6. **Bounded learning.** The system learns by recording observations and computing effectiveness statistics. Promoting an observation into a Pattern always goes through the Pattern Validation gate — never silent mutation.
7. **Termination is a policy.** Loops stop on: target reached, max iterations, cost budget, wall-clock, or diminishing returns. Never infinite.
8. **Production-first, not demo-first.** Stable dependencies only (no alpha). Structured logging, cost accounting, and error tracking from day one.
9. **No placeholders.** Every module ships real logic. Capacity gaps (pattern count, backends) are data/roadmap, not stubs.

---

## 4. Domain Model (Ubiquitous Language)

| Term | Definition |
|---|---|
| **CreativeBrief** | User request + constraints + target quality + provider hints. The input contract. |
| **Artifact** | A generated output (code/text/markup) under evaluation. |
| **Pattern** | Reusable expert specification: required/optional elements, quality rules, anti-patterns, examples, references. Versioned + provenance-tracked. |
| **Critique** | Evaluation result: dimension scores, findings (strengths/weaknesses/missing/issues/opportunities), prioritized suggestions, expected uplift, full justification tree. |
| **Score** | 0–100 per dimension + weighted aggregate. |
| **Evidence** | Measured facts about an Artifact (lint findings, metrics, parsed structure, optional screenshots). |
| **ImprovementPlan** | Structured set of changes derived from a Critique (targets, strategy, surgical edits). |
| **RevisionPrompt** | Provider-ready prompt to produce the next Artifact. |
| **Session** | One end-to-end run: brief → … → final artifact, with full timeline. |
| **History** | Session timeline (what happened *this* run). |
| **MemoryRecord** | Durable cross-session observation (what we learned *across* runs). |
| **Provider** | A model backend advertising Capabilities. |
| **Capabilities** | streaming, toolUse, structuredOutput, vision, contextWindow, supportsSystemPrompt. |
| **GenerationRequest / GenerationResponse** | Provider I/O with token/cost/latency metadata. |
| **TelemetrySpan** | One observable unit of work (start/end, attributes, events, status). |
| **TerminationPolicy** | The rules that end a loop. |

**History vs Memory (intentional distinction):** History = intra-session timeline. Memory = inter-session durable knowledge. Conflating them is a common tech-debt source.

---

## 5. Data Models

All internal contracts are validated with **JSON Schema (ajv)** at the boundaries and **zod** at the MCP tool boundary. Artifact validity uses language-aware validators (parse/compile), not JSON schema.

### 5.1 Core records (TS shapes — full definitions live in `src/types/`)

- `CreativeBrief` — `{ id, userId?, intent, domain, constraints, targetScore, maxIterations, costBudgetUsd?, providerHints?, seedArtifact? }`
- `Pattern` — `{ id, name, description, category, version, provenance, requiredElements[], optionalElements[], qualityRules[], antiPatterns[], improvementSuggestions[], exampleOutputs[], references[] }`
- `Critique` — `{ artifactId, sessionId, dimensionScores{}, aggregateScore, findings[], justification[], expectedUpliftIfApplied, criticVersion }`
- `Finding` — `{ id, dimension, severity, kind: strength|weakness|missing|designIssue|techIssue|opportunity, ruleId, message, evidence, suggestedFix? }`
- `ImprovementPlan` — `{ id, critiqueId, changes[], strategy, targetDimensions[], regenerateScope: full|surgical, expectedUplift }`
- `Session` — `{ id, briefId, status, startedAt, endedAt?, iterations[], finalArtifactId?, finalScore?, totalTokens, totalCostUsd, providerUsed }`
- `MemoryRecord` — `{ id, kind, patternCategory?, key, value, effectiveness{attempts, successes, avgUplift}, createdAt, updatedAt }`
- `TelemetrySpan` — `{ traceId, spanId, parentSpanId?, name, kind, startMs, endMs, status, attributes{}, events[] }`

### 5.2 Provider & telemetry
- `Capabilities`, `GenerationRequest`, `GenerationResponse` (incl. `usage{promptTokens, completionTokens, totalTokens, costUsd, latencyMs}`).

---

## 6. MCP Tool Definitions

Small, composable surface. Internal modules are NOT exposed directly.

| Tool | Input (zod) | Output (structured) | Purpose |
|---|---|---|---|
| `direct_creative_work` | `{ intent, domain, targetScore?, maxIterations?, provider?, seedArtifact? }` | `Session` summary + final artifact + final critique | End-to-end (~80% of usage). |
| `critique_artifact` | `{ artifact, domain, patternId? }` | `Critique` | Evaluate existing artifact; no generation. |
| `improve_artifact` | `{ artifact, critique, patternId?, provider? }` | `ImprovementPlan` + revised artifact | One-shot improve from a critique. |
| `list_patterns` | `{ category?, query? }` | `Pattern[]` (summaries) | Browse pattern library. |
| `get_pattern` | `{ patternId }` | full `Pattern` | Fetch one pattern. |
| `recall_sessions` | `{ query?, limit? }` | `Session[]` (summaries) | Memory/history retrieval. |
| `get_quality_trends` | `{ since?, groupBy? }` | trend report | Analytics. |

Every tool handler wraps work in a telemetry span, validates input, and returns `structuredContent` plus a human-readable `text` blob.

---

## 7. MCP Resource Definitions

Browseable knowledge via resource URIs.

| URI | Template | Content |
|---|---|---|
| `pattern://{patternId}` | `ResourceTemplate` with `list` | Full Pattern JSON. |
| `pattern://category/{category}` | static-ish list | Patterns in a category. |
| `session://{sessionId}` | `ResourceTemplate` | Session timeline JSON. |
| `trends://quality` | static | Latest quality trend report. |
| `config://runtime` | static | Runtime capabilities + provider availability (no secrets). |

Resources are read-only views of internal state — useful for clients that prefer retrieval over tool calls.

---

## 8. MCP Prompt Definitions

Opinionated workflow templates that compose the tools.

| Prompt | Args | Yields |
|---|---|---|
| `critique-then-improve` | `{ artifact, domain }` | A message sequence guiding a client to call `critique_artifact` then `improve_artifact`. |
| `generate-fantasy-vfx` | `{ effect, targetScore? }` | Pre-wired for fantasy/lightning/magic-circle patterns + `direct_creative_work`. |
| `audit-ui-consistency` | `{ artifact }` | UI/glassmorphism/landing-page patterns + `critique_artifact`. |
| `threejs-scene-review` | `{ artifact }` | R3F/Three.js patterns + critique with technical-quality focus. |

Prompts are thin: they encode workflow, not logic. Logic stays in tools.

---

## 9. Module Responsibilities

| User-named module | Domain package | Responsibility |
|---|---|---|
| planner | `pipeline/planner` | Decompose brief into a plan: domain detection, target patterns, strategy, budget allocation. |
| knowledge | `knowledge/` | Collect from sources by priority, **sanitize** (untrusted data), normalize to `KnowledgeFragments`. Pluggable collectors. |
| patterns | `patterns/` | Load, validate (schema), version, select, serve patterns. Repository interface. |
| critic | `critic/` | Run rules + LLM reasoning over Artifact+Evidence → `Critique` with full justification. Includes scoring. |
| scoring | `critic/scoring` | Weighted rubric engine; deterministic math; per-rule contribution audit. (Sub-module of critic.) |
| improver | `improver/` | Derive `ImprovementPlan` + `RevisionPrompt` from `Critique`; surgical edit suggestions. |
| loop_controller | `pipeline/loop` | State machine: feedback edges + `TerminationPolicy`. |
| providers | `providers/` | Capability-based `Provider` abstraction + adapters (Stub, OpenAI-compatible, Claude). |
| cache | `infrastructure/cache` | Response/embedding cache behind interface (MVP: LRU in-memory). |
| telemetry | `infrastructure/telemetry` | Structured logs, metrics, spans, cost accounting via `TelemetrySink`. |
| history | `memory/history` | Session timeline repository (intra-session). |
| memory | `memory/` | Cross-session `MemoryRecord` repository + retrieval; bounded learning via Analytics. |
| analytics | `memory/analytics` | Effectiveness stats, quality trends, pattern ROI. Feeds Memory + `get_quality_trends`. |
| configuration | `infrastructure/config` | Layered config (file → env → CLI), validation, secret redaction. |

---

## 10. Folder Structure

```
prometheus-mcp/
├─ docs/
│  ├─ ARCHITECTURE.md            (this file — deliverables 1–24)
│  ├─ ARCHITECTURE_REVIEW.md     (deliverable 25)
│  └─ adr/
│     ├─ 0001-mcp-sdk-stable-not-alpha.md
│     ├─ 0002-state-machine-not-linear.md
│     ├─ 0003-capability-based-providers.md
│     ├─ 0004-evidence-collector.md
│     ├─ 0005-repository-interfaces.md
│     └─ 0006-bounded-learning.md
├─ patterns/                     (pattern data — the library content)
│  └─ *.pattern.json
├─ src/
│  ├─ index.ts                   (MCP server entry: registers tools/resources/prompts)
│  ├─ types/                     (shared TS interfaces + zod schemas)
│  ├─ pipeline/                  (planner, orchestrator, loop_controller)
│  ├─ knowledge/                 (collectors, sanitizer, normalizer)
│  ├─ patterns/                  (repository, selector, validator)
│  ├─ critic/                    (engine, scoring, rules, evidence)
│  ├─ improver/                  (plan builder, revision prompt, surgical edits)
│  ├─ providers/                 (capabilities, stub, openai-compatible, claude, router)
│  ├─ memory/                    (history, memory, analytics repositories)
│  ├─ infrastructure/            (config, cache, telemetry, security, logging)
│  └─ mcp/                       (tool/resource/prompt registrations — the surface)
├─ tests/                        (vitest: unit + in-memory MCP smoke)
├─ package.json  tsconfig.json  vitest.config.ts  eslint.config.mjs
```

---

## 11. TypeScript Interfaces

(Complete implementations in `src/types/` and each module. Key interfaces:)

- `IPatternRepository` — `load(), get(id), list(category?), search(query), validate(p)`
- `ICritic` — `critique(artifact, evidence, patternCtx): Promise<Critique>`
- `IImprover` — `improve(critique, artifact, patternCtx): Promise<ImprovementPlan>`
- `ILoopController` — `run(brief): Promise<Session>`
- `IProvider` — `capabilities: Capabilities; generate(req): Promise<GenerationResponse>`
- `IProviderRouter` — `select(hints): Provider`
- `IKnowledgeCollector` — `collect(brief): Promise<KnowledgeFragment[]>`
- `ISanitizer` — `sanitize(raw, sourceKind): SanitizationResult`
- `IHistoryRepository`, `IMemoryRepository`, `IAnalyticsRepository`
- `ITelemetrySink` — `logEvent, startSpan/endSpan, metric, cost`
- `ICache` — `get/set/invalidate`
- `IConfigStore`

---

## 12. Pattern Library Design

- **Schema:** enforced by `PatternValidator` (JSON Schema + semantic checks: no contradictory rules, no anti-pattern that duplicates a required element, examples reference declared elements).
- **Provenance & versioning:** each pattern carries `version` (semver) + `provenance {source, author, commit?, fetchedAt, trust}`. Trust levels: `internal | verified | community | untrusted`. Only `internal|verified` feed the Critic by default.
- **Selection:** `PatternSelector` scores patterns against the brief (domain match, element coverage, past effectiveness from Memory). Returns ranked candidates.
- **Scaling to 1000+:** the repository loads an index in memory; pattern bodies are lazily fetched. The same interface backs a file dir (MVP) or a DB/vector store (production). Capacity is data, not code.
- **Authoring:** patterns are JSON files in `/patterns`. A CLI (roadmap) will lint/validate. MVP ships ~12 fully-specified patterns (one per example category).

---

## 13. Critic Engine Design

Two-phase: **Evidence** then **Reasoning**.

1. **EvidenceCollector** gathers deterministic facts:
   - Structural parse (HTML/JSX/JS validity), balanced tags, import analysis.
   - Accessibility checks (alt text, labels, contrast heuristics, semantic landmarks).
   - Responsive checks (media queries / fluid units / viewport meta).
   - Performance heuristics (bundle size estimate, animation count, reflow risks).
   - Pattern conformance (required elements present? anti-patterns present?).
   - Optional (roadmap): headless render → screenshot → vision critique.
2. **CriticEngine** runs:
   - **Rule engine:** ~30+ rules across 14 dimensions. Each rule: `{id, dimension, weight, evaluate(evidence, artifact, patternCtx) → {score, findings[]}}`. Deterministic, unit-tested, auditable.
   - **LLM reasoning pass** (optional, when a provider with reasoning is available): synthesizes qualitative findings the rules can't measure (creative originality, modern design practices) — but its output is **bound by evidence** and must cite evidence ids. It can adjust a dimension by at most ±15 (capped) to prevent ungrounded swings.
3. **Scoring:** weighted aggregate (weights configurable, default balanced). Every contribution recorded in `justification[]` (ruleId, dimension, delta, evidence).
4. **Output:** full `Critique` — strengths, weaknesses, missing, design issues, tech issues, opportunities, prioritized suggestions with expected uplift, aggregate + per-dimension scores, justification tree, critic version.

---

## 14. Scoring System Design

- Range **0–100** per dimension and aggregate.
- Default weights across 14 dimensions (sum 1.0), overridable in config.
- **Normalization:** each rule returns a 0–1 sub-score × weight within its dimension; dimension score = Σ(ruleSubScore×ruleWeight)×100, clamped.
- **Audibility:** `justification[]` lets any score be reconstructed. `expectedUpliftIfApplied` quantifies the suggested fixes' impact (sum of rule deltas, capped).
- **Anti-gaming:** LLM reasoning contribution is capped (±15) and must cite evidence; rules are deterministic. No dimension can hit 100 on text reasoning alone for measurable dimensions — evidence must support it.

---

## 15. Improvement Engine Design

- Input: `Critique` + `Artifact` + `PatternCtx`.
- Output: `ImprovementPlan { changes[], strategy, targetDimensions[], regenerateScope, expectedUplift }` + `RevisionPrompt`.
- **Strategy selection:** if findings are localized (e.g., one missing element, one a11y fix) → `surgical` (targeted edits). If systemic (consistency, originality) → `full` regeneration.
- **Change objects:** `{ dimension, findingId, kind: add|remove|replace|refactor, target, description, codeSnippet? }`.
- **RevisionPrompt:** assembles pattern requirements + targeted changes + anti-patterns to avoid + retained strengths, as **structured instructions**, with the prior artifact provided as *data*. Never blindly appends critique text.
- **Memory consultation:** before finalizing, retrieve past successful plans for similar pattern/dimension pairs; prefer strategies with high effectiveness.

---

## 16. Loop Controller Design

State machine with states: `plan, collect, select, enhance, generate, evidence, critique, improve, decide, finalize`. Edges:
- `critique → improve` (always).
- `improve → decide`.
- `decide → finalize` if policy satisfied.
- `decide → collect` (knowledge gap), `decide → select` (wrong pattern), `decide → generate` (regenerate), per critique's `recommendedNextStep`.
- **TerminationPolicy:** `{ targetScore, maxIterations, maxCostUsd, maxWallClockMs, minDeltaImprovement, maxFlatIterations }`. Stop on any threshold or diminishing returns (`Δ < minDelta` for `maxFlat` iterations).
- **Partial regeneration:** respects `regenerateScope` to save tokens.
- **Checkpointing (roadmap):** human-in-the-loop pause/resume for enterprise.

---

## 17. Memory System Design

- **HistoryRepository:** append-only session timeline (iterations, critiques, generations). Intra-session.
- **MemoryRepository:** cross-session `MemoryRecord`s: `{kind: patternEffectiveness | improvementStrategy | failureCase | qualityTrend, key, value, effectiveness}`.
- **Retrieval:** simple keyword/category match in MVP; vector similarity in roadmap (behind the same interface).
- **Bounded learning:** Analytics computes `effectiveness` from history. Proposing a new/updated Pattern from a successful strategy goes through `PatternValidator` + a review gate (config: auto-promote-community vs require-approval). **Never silent mutation** — every pattern change is versioned and auditable.

---

## 18. Provider Abstraction Design

**Capability-based**, not flat adapters.

- `Provider.capabilities: Capabilities` — `{ streaming, toolUse, structuredOutput, vision, contextWindow, supportsSystemPrompt }`.
- `IProvider.generate(req): Promise<GenerationResponse>` — uniform; adapter handles vendor format.
- **Router** selects a provider by matching task-required capabilities + hints + cost.
- Adapters in MVP:
  - **StubProvider** — deterministic, no network, for offline/test/no-API-key. Returns pattern-grounded template output so the whole pipeline is exercisable end-to-end without a key.
  - **OpenAICompatibleProvider** — base URL + key + model. **One adapter serves OpenAI, DeepSeek, MiniMax, Qwen, GLM** (all expose an OpenAI-compatible Chat Completions endpoint). Vendor-specific quirks are capability flags + small overrides, not separate classes.
  - **ClaudeProvider** — Anthropic Messages API adapter.
- Future providers = declare capabilities + implement `generate`. No orchestrator changes.

---

## 19. Telemetry Design

- `TelemetrySink` interface; MVP sinks: `ConsoleJsonSink`, `CompositeSink`. Roadmap: `OtlpSink`.
- **Spans** for every pipeline stage and provider call (`traceId` propagated through a session).
- **Metrics:** scores per dimension over time, iterations-to-target, tokens/cost per session, pattern usage, rule fire rates.
- **Cost accounting:** every `GenerationResponse` records `usage.costUsd`; the session rolls these up; `costBudgetUsd` enforced by LoopController.
- **Secret redaction:** logs never emit API keys or full user content above a configured size; `SecretRedactor` wraps sinks.
- **No scattered console.log** — everything flows through telemetry.

---

## 20. Security Design

- **Input validation:** all MCP tool inputs validated by zod; all internal records by JSON Schema (ajv).
- **Prompt injection defense:** external knowledge is sanitized: stripped of instruction-like patterns (`<system>`, `ignore previous`, role markers), confined to a fenced data section in prompts, and schema-validated to expected shape. `Sanitizer` returns a `quarantined` flag; quarantined content is dropped, not used.
- **Malicious pattern defense:** `PatternValidator` rejects patterns with contradictory rules, executable content, or untrusted provenance feeding the Critic (configurable). Patterns are content-as-policy — validated + trust-gated.
- **Provider isolation:** each provider runs in its own adapter; secrets live only in config (env/file), never in patterns or telemetry. Provider failure is isolated (one provider down doesn't crash the session; router can fall back).
- **Secret hygiene:** `SecretRedactor`; config validates that no secret is logged; `.env`-style loading with explicit allowlists.
- **Resource limits:** max artifact size, max iteration tokens, timeouts on provider calls and knowledge fetches.

---

## 21. Testing Strategy

Layered (no real LLM calls in CI):

1. **Unit (deterministic, fast):** scoring math, rule verdicts on fixture artifacts (good/bad), pattern validation, sanitizer injection cases, loop termination policy, surgical-edit planner, provider capability matching. → Vitest.
2. **Provider fakes:** a `FakeProvider` returning canned `GenerationResponse`s to test orchestration end-to-end without network.
3. **Rule fixtures:** each critic rule has `good` and `bad` artifact fixtures with expected findings — rule regression tests.
4. **MCP smoke (in-memory transport):** the SDK's in-memory client/server pair drives `direct_creative_work` and `critique_artifact` with the StubProvider — verifies registration, schemas, plumbing, structured output.
5. **Offline eval harness (roadmap):** real-model quality benchmarking, run manually, not in CI.

CI = deterministic. Real-model eval = separate. Conflating them is the #1 cause of flaky AI CI.

---

## 22. MVP Scope

A **real, working, non-placeholder** v1 an MCP client can connect to and use:

- All 14 modules with genuine logic.
- 12 fully-specified patterns (one per example category) loaded by the real repository (code scales to 1000 unchanged).
- Critic: weighted rubric + 30+ concrete rules + evidence collector (HTML/JSX validity, a11y, responsive, perf heuristics, pattern conformance) + auditable justification + optional capped LLM reasoning.
- Improver: structured plans + revision prompts + surgical edits.
- LoopController: state machine + full termination policy + partial regeneration.
- Providers: Stub (deterministic) + OpenAI-compatible (covers 5/6 vendors for real) + Claude adapter interface; capability-based router.
- Knowledge: pluggable collectors + sanitizer; internal patterns as primary source.
- Memory/History: file-backed repositories behind interfaces.
- Telemetry: structured JSON spans/metrics/cost with secret redaction.
- MCP surface: 7 tools, 5 resources, 4 prompts — all wired to real logic.
- Tests: Vitest unit + in-memory MCP smoke.

**Not in MVP (roadmap):** vision-based critique, OTLP export, distributed backends, vector memory, 1000 patterns, human-in-the-loop checkpoints, eval harness, Context7 live calls (interface ready).

---

## 23. Production Roadmap

| Phase | Theme | Items |
|---|---|---|
| 0 (MVP) | Working director | Above. |
| 1 | Evidence depth | Headless render → screenshot → vision critique (vision-capable providers); real eslint/axe/bundle integrations; Lighthouse CI. |
| 2 | Scale | 1000+ patterns + pattern authoring CLI; vector memory (pgvector); Redis history; pattern marketplace ingestion with trust scoring. |
| 3 | Distributed | StreamableHTTP transport; stateless orchestrator + shared repos; concurrent evaluations; queue-based generation. |
| 4 | Observability | OTLP sink; Grafana dashboards; SLOs on score-improvement and cost-per-uplift-point. |
| 5 | Learning | Analytics-driven pattern promotion (reviewed); strategy bandits (explore/exploit improvement strategies). |
| 6 | Enterprise | RBAC; audit log; multi-tenant memory; on-prem provider adapters; human checkpoints; SOC2-aligned controls. |

---

## 24. Risk Analysis

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| LLM critic ungrounded swings | Trust loss | M | Evidence-bound + ±15 cap + auditable justification. |
| Prompt injection via knowledge | Security breach | M-H | Sanitizer, untrusted-data framing, schema validation, quarantine. |
| Runaway loop cost | Cost/SLO | M | TerminationPolicy (iters, cost, clock, diminishing returns). |
| Provider vendor lock-in | Extinction | L | Capability abstraction; OpenAI-compat covers 5/6. |
| Pattern corruption via "learning" | Quality drift | M | Bounded learning + validation gate + versioning. |
| Alpha SDK churn | Breakage | H if used | Rejected alpha; stable 1.29.0 pinned. |
| Measurable dimensions text-only scored | Inaccurate scores | H if no evidence | EvidenceCollector is mandatory stage. |
| Scope creep to 1000 patterns | Dilution | M | MVP = 12 real; scaling is data, not code. |

(Full critical review in `ARCHITECTURE_REVIEW.md`.)
