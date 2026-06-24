# Architecture Decision Records — Prometheus-MCP

Consolidated ADR log. Each decision records context, decision, rationale, consequences (pros/cons/risks/long-term).

---

## ADR 0001 — Use stable MCP SDK 1.29.0, reject the 2.0.0-alpha
**Context:** Two SDK lines exist — stable `@modelcontextprotocol/sdk@1.29.0` and `@modelcontextprotocol/server@2.0.0-alpha.2`.
**Decision:** Pin `@modelcontextprotocol/sdk@^1.29.0` (stable, high-level `McpServer`). Defer v2 to roadmap.
**Rationale:** Spec mandates production-readiness. Alpha churn is an unacceptable risk for a 10-year system.
**Consequences:** Pros: stable API, broad client support, zod v3 peer. Cons: miss v2 `registerTool` config-object ergonomics. Risks: future v2 migration. Long-term: migrate when v2 stabilizes; surface is thin so migration is bounded.

## ADR 0002 — State machine with feedback edges, not a linear pipeline
**Context:** The user's sketch was a linear chain.
**Decision:** Model the pipeline as a state machine with feedback edges (`decide → collect|select|generate`); Critic emits `recommendedNextStep`.
**Rationale:** Real creative direction is not linear; full regeneration on every defect is token-quadratic.
**Consequences:** Pros: partial regeneration, targeted re-research, faithful workflow. Cons: more complex control flow. Risks: state-machine bugs. Long-term: supports human-in-the-loop checkpoints and distributed execution.

## ADR 0003 — Capability-based providers, not flat per-vendor adapters
**Context:** Must support Claude, GPT, DeepSeek, MiniMax, Qwen, GLM, future vendors without lock-in.
**Decision:** `Provider.capabilities: Capabilities`; one `OpenAICompatibleProvider` serves the 5 OpenAI-compatible vendors; `ClaudeProvider` separate; router matches capabilities to task.
**Rationale:** Flat adapters either leak abstractions or become lowest-common-denominator.
**Consequences:** Pros: adding a vendor = declare caps + implement `generate`; no orchestrator change. Cons: capability set must evolve. Risks: capability mismatch at runtime. Long-term: future-proof; supports vision/streaming/structured-output selection.

## ADR 0004 — Mandatory Evidence Collector stage before the Critic
**Context:** Measurable dimensions (a11y, performance, responsiveness, technical quality) cannot be reliably text-scored.
**Decision:** `EvidenceCollector` is a mandatory stage producing deterministic facts; LLM reasoning is evidence-bound, must cite evidence ids, and is capped at ±15 per dimension.
**Rationale:** This is the core "AI Creative Director vs re-prompting" separator; it makes scores auditable and debuggable.
**Consequences:** Pros: trustworthy scores; headless-render→vision can slot in later behind the same interface. Cons: MVP evidence is heuristic (AST-lite/regex), honestly labeled. Risks: heuristic false positives. Long-term: Phase-1 swaps in real browser/axe/Lighthouse.

## ADR 0005 — Repository interfaces at every swappable seam
**Context:** Must scale from in-process MVP to distributed enterprise without domain-logic changes.
**Decision:** `IPatternRepository`, `IMemoryRepository`, `IHistoryRepository`, `ITelemetrySink`, `ICache`, `IKnowledgeCollector` interfaces. MVP = file/in-process; production = Redis/Postgres/pgvector/OTLP.
**Rationale:** Scaling should be a data/backing-store concern, not a code concern.
**Consequences:** Pros: zero domain-logic change to scale; testability via fakes. Cons: interface indirection. Risks: leaky abstractions if an impl needs a capability the interface lacks. Long-term: the key 10-year extensibility decision.

## ADR 0006 — Bounded learning; no silent pattern mutation
**Context:** "System learns from experience" risks unreviewable quality drift.
**Decision:** Analytics computes `effectiveness`; promoting an observation into a Pattern passes `PatternValidator` + a review gate; patterns are versioned + trust-tiered.
**Rationale:** A quality system that silently changes its own rules is untrustworthy.
**Consequences:** Pros: trust-preserving, enterprise-ready, auditable. Cons: slower learning. Risks: gate too strict stalls improvement. Long-term: reviewed auto-promotion in Phase-5.

## ADR 0007 — Small MCP tool surface; 14 modules internal
**Context:** Exposing every module as a tool creates a brittle, churning API.
**Decision:** ~7 tools (`direct_creative_work`, `critique_artifact`, `improve_artifact`, `list_patterns`, `get_pattern`, `recall_sessions`, `get_quality_trends`); 14 modules are internal implementation.
**Rationale:** Internal refactors must not break MCP clients.
**Consequences:** Pros: stable client API, high-level intent. Cons: less granular control. Risks: power users want lower-level access (mitigated by resources). Long-term: add tools only when a stable, repeated need emerges.

## ADR 0008 — External knowledge is untrusted data, never instructions
**Context:** Context7/docs/GitHub/external MCPs can carry prompt-injection payloads.
**Decision:** All external content passes `Sanitizer` (strip instruction markers, fence as data, schema-validate, quarantine suspicious) before use.
**Rationale:** Defense-in-depth for the most common AI security failure.
**Consequences:** Pros: injection-resistant. Cons: may drop legitimate content that looks instruction-like. Risks: false quarantine. Long-term: pattern-as-policy trust tiers extend the same principle to community patterns.
