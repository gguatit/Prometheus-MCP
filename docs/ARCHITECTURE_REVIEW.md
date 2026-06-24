# Architecture Review — Prometheus-MCP

> Principal-engineer review of the proposed design, performed **before** implementation. Finds weaknesses, scalability bottlenecks, tech-debt risks, and proposes alternatives. This is the gate the spec requires: *no implementation until review completes.*

## Review posture
Reviewing as if this will run for 10 years and be used by millions. Every decision is doubted. Short-term simplicity is rejected in favor of maintainability, extensibility, observability, and evolvability.

---

## A. Findings against the user's original linear pipeline

### A1. Linear pipeline is too rigid — FIXED
**Problem:** `Planner → Knowledge → Pattern → Enhancer → Generate → Critic → Score → Improve → Loop` forces every defect into a full regeneration. Real creative direction sometimes says "research more" or "wrong idiom", not "regenerate".
**Fix adopted:** State machine with feedback edges (`decide → collect|select|generate`). `CriticEngine` emits `recommendedNextStep`.
**Rationale:** Token economics + faithful creative-director workflow. **Long-term impact:** enables partial regeneration and targeted re-research; avoids quadratic cost growth.

### A2. Critic and Scoring shown as separate stages — FIXED
**Problem:** Scoring is *produced by* the Critic; modeling them as sequential stages misleads implementers.
**Fix adopted:** `scoring` is a sub-module of `critic`. Single `Critique` output. **Long-term impact:** one auditable artifact, one source of truth.

### A3. No evidence stage — FIXED (critical)
**Problem:** Visual/technical dimensions (Accessibility, Performance, Responsiveness, Technical Quality) **cannot** be reliably scored by pure text reasoning. The original spec listed these dimensions but provided no measurement mechanism.
**Fix adopted:** `EvidenceCollector` is a mandatory stage before Critic: static analysis (parse validity, a11y, media queries, bundle heuristic, pattern conformance). LLM reasoning is evidence-bound and capped.
**Rationale:** This is the single biggest separator between "AI Creative Director" and "LLM re-prompting". **Long-term impact:** scores become trustworthy and debuggable; roadmap adds headless-render→vision critique behind the same evidence interface.

---

## B. Scalability bottlenecks

### B1. Pattern library at 1000+
**Risk:** Loading 1000 pattern bodies eagerly is wasteful; searching them linearly is O(n).
**Mitigation:** Lazy body fetch + in-memory index (category/element tags). The `IPatternRepository` interface is identical for file-dir (MVP) and DB/vector (production). **Verified:** scaling is a data/backing-store concern, not a domain-logic concern. No code change to reach 1000.

### B2. Provider routing under concurrency
**Risk:** A single in-process router is a bottleneck for concurrent evaluations.
**Mitigation:** Router is stateless per-request; provider clients are pooled; in MVP concurrency is modest (stdio is request/response). Production distributed routing is a Phase-3 roadmap item with the interface already in place.

### B3. Memory retrieval
**Risk:** Keyword retrieval won't scale to large cross-session histories.
**Mitigation:** `IMemoryRepository` interface; MVP keyword, roadmap vector (pgvector) — swap without touching Analytics or LoopController.

---

## C. Tech-debt risks

### C1. Vendor lock-in via flat provider adapters
**Risk:** A flat `Provider` interface becomes a leaky abstraction (optional fields exposing vendor quirks) or lowest-common-denominator (loses vendor strengths).
**Fix adopted:** Capability-based providers. Adding a vendor = declare capabilities + implement `generate`. Router matches capabilities to task. **Long-term impact:** future-proof; no orchestrator churn per vendor.

### C2. "Learning" as hand-wavy mutation
**Risk:** "System learns from experience" implemented as silent pattern mutation → unreviewable quality drift, the worst kind of tech debt for a quality system.
**Fix adopted:** Bounded learning: Analytics computes `effectiveness`; promoting an observation into a Pattern passes `PatternValidator` + a review gate. Versioned + auditable. **Long-term impact:** trust-preserving; enterprise-ready.

### C3. Conflating validation layers
**Risk:** Using JSON Schema for *artifact* validation (code) is insufficient; using language-aware validation for *internal records* is overkill.
**Fix adopted:** Two layers — JSON Schema (ajv) for internal records; zod for MCP tool I/O; language-aware validators (parse/compile) for artifacts. **Long-term impact:** each layer right-sized; no false confidence.

### C4. Scattered logging
**Risk:** `console.log` scattered through modules → unobservable in prod, secrets leak.
**Fix adopted:** Single `TelemetrySink` interface; all logs/metrics/spans/cost flow through it; `SecretRedactor` wraps sinks. **Long-term impact:** OTLP export is a new sink, zero module changes.

### C5. Testing with real LLM calls in CI
**Risk:** Flaky, costly, non-deterministic CI; erodes trust in the build.
**Fix adopted:** Layered tests; CI uses `FakeProvider`/`StubProvider` + in-memory MCP transport; real-model eval is a separate offline harness. **Long-term impact:** CI stays green and fast; quality regressions caught by rule fixtures.

---

## D. Security review

### D1. Prompt injection from external knowledge
**Threat:** A malicious GitHub README or doc page injects instructions that hijack generation.
**Defense:** `Sanitizer` treats all external content as **untrusted data**: strips instruction-like markers, confines content to a fenced data section in prompts, schema-validates expected shape, quarantines (drops) suspicious content. Knowledge is never placed in instruction context.

### D2. Malicious patterns
**Threat:** A community pattern with contradictory rules or embedded payload biases the Critic.
**Defense:** `PatternValidator` (semantic + schema), trust levels (`internal|verified|community|untrusted`), only `internal|verified` feed the Critic by default. Patterns are content-as-policy — validated and versioned.

### D3. Secret leakage
**Threat:** API keys in logs/metrics.
**Defense:** Secrets live only in config (env/file allowlist); `SecretRedactor` wraps telemetry sinks; logs cap content size.

### D4. Runaway cost / DoS
**Threat:** A pathological brief or adversarial input causes unbounded iterations.
**Defense:** `TerminationPolicy` (max iterations, cost budget, wall-clock, diminishing returns) + input size limits + provider call timeouts.

---

## E. SDK decision (verified, not assumed)

`@modelcontextprotocol/server@2.0.0-alpha.2` is **alpha** — rejected for a production system per the spec's "프로덕션 환경 대응" requirement. **Adopted:** `@modelcontextprotocol/sdk@^1.29.0` (stable), high-level `McpServer` API (`.tool/.resource/.prompt`), `ResourceTemplate`, stdio transport (MVP), zod v3. Roadmap: StreamableHTTP for remote enterprise. Verified via Context7 + npm registry.

---

## F. What was rejected and why

| Rejected | Reason |
|---|---|
| Alpha MCP SDK v2 | Production-unsuitable; churn risk. |
| Flat per-vendor provider classes | Leak abstraction / lowest-common-denominator. |
| Linear pipeline | Rigid; forces full regen; unfaithful to creative direction. |
| Text-only critic for measurable dimensions | Inaccurate; not an AI director, just re-prompting. |
| Silent autonomous learning | Unreviewable quality drift. |
| Real LLM calls in CI | Flaky, costly, non-deterministic. |
| 26 separate design-doc files | Wasteful; one structured doc + ADRs is clearer and more maintainable. |

---

## G. Residual risks (honest)

- **MVP ships StubProvider for zero-key operation** — real LLM quality is validated by the offline eval harness (roadmap). The StubProvider generates real R3F/Three.js/WebGPU code (BufferGeometry, PointsMaterial, AdditiveBlending, useFrame with delta, dispose cleanup, WebGLRenderer config, WebGPU pipeline with navigator.gpu guards), not a mock that pretends; but it is not a substitute for a frontier model. This is clearly scoped, not hidden.
- **Evidence Collector in MVP uses heuristics** (regex/AST-lite for HTML/JSX/JS), not a full browser. The *interface* is stable so Phase-1 swaps in headless rendering. Heuristics are deterministic and unit-tested — adequate for MVP, honestly labeled.
- **22 patterns, not 1000.** The code is identical; the library is a data concern. Risk is content coverage, not architecture. Coverage spans web UI (12) + 3D/game (10: 2D platformer, 3D action, top-down shooter, physics puzzle, racing, WebGL shader art, WebGPU render pipeline, R3F postprocessing, game state manager, ECS architecture).

---

## H. Verdict

The design is **approved for implementation** with the fixes above incorporated. The architecture is state-machine + evidence-bound critic + capability providers + repository interfaces + bounded learning + production SDK + layered tests. It is extensible at every swappable seam, observable by construction, and honest about MVP scope. Implementation may proceed.
