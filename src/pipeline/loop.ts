import type {
  CreativeBrief,
  Session,
  IterationRecord,
  TerminationPolicy,
  Artifact,
  Critique,
  LoopState,
  RecommendedNextStep,
} from "../types/index.js";
import { newId } from "../infrastructure/telemetry.js";

/**
 * LoopController — the state machine. Tracks iteration state, enforces the
 * TerminationPolicy (target / maxIterations / cost / wall-clock / diminishing
 * returns), and routes based on the Critic's recommendedNextStep.
 *
 * It does NOT contain domain logic; it coordinates. Domain logic lives in the
 * modules the orchestrator calls. This separation keeps the control flow
 * testable in isolation.
 */

export interface LoopContext {
  brief: CreativeBrief;
  policy: TerminationPolicy;
  session: Session;
  iteration: IterationRecord;
  lastCritique?: Critique;
  flatIterations: number;
  startedWallMs: number;
  accumulatedCostUsd: number;
  state: LoopState;
}

export interface TerminationDecision {
  terminate: boolean;
  reason: string;
}

export function newSession(brief: CreativeBrief): Session {
  return {
    id: newId("sess"),
    briefId: brief.id,
    status: "running",
    startedAt: new Date().toISOString(),
    iterations: [],
    totalTokens: 0,
    totalCostUsd: 0,
    providerUsed: "stub" as Session["providerUsed"],
    patternIds: [],
  };
}

export function newIteration(index: number): IterationRecord {
  return { index, startedAt: new Date().toISOString(), tokens: 0, costUsd: 0 };
}

/** Evaluate termination policy against the current context. */
export function shouldTerminate(ctx: LoopContext): TerminationDecision {
  const { policy, session, iteration, lastCritique, flatIterations, startedWallMs, accumulatedCostUsd } = ctx;

  // target reached
  if (lastCritique && lastCritique.aggregateScore >= policy.targetScore) {
    return { terminate: true, reason: `target score ${lastCritique.aggregateScore} >= ${policy.targetScore}` };
  }
  // max iterations
  if (session.iterations.length >= policy.maxIterations) {
    return { terminate: true, reason: `max iterations (${policy.maxIterations}) reached` };
  }
  // cost budget
  if (policy.maxCostUsd !== undefined && accumulatedCostUsd >= policy.maxCostUsd) {
    return { terminate: true, reason: `cost budget $${policy.maxCostUsd} reached` };
  }
  // wall clock
  if (policy.maxWallClockMs !== undefined && Date.now() - startedWallMs >= policy.maxWallClockMs) {
    return { terminate: true, reason: `wall-clock ${policy.maxWallClockMs}ms reached` };
  }
  // diminishing returns
  if (flatIterations >= policy.maxFlatIterations && lastCritique) {
    const prev = session.iterations[session.iterations.length - 2]?.critique?.aggregateScore;
    if (prev !== undefined && lastCritique.aggregateScore - prev < policy.minDeltaImprovement) {
      return { terminate: true, reason: `diminishing returns (Δ < ${policy.minDeltaImprovement} for ${flatIterations} flat iters)` };
    }
  }
  void iteration;
  return { terminate: false, reason: "" };
}

/** Map the Critic's recommendedNextStep to the next LoopState. */
export function nextRoute(step: RecommendedNextStep): LoopState {
  switch (step) {
    case "finalize":
      return "finalize";
    case "regenerate":
      return "generate";
    case "research":
      return "collect";
    case "reselect":
      return "select";
    case "improve":
    default:
      return "improve";
  }
}

/** Track flat (non-improving) iterations for diminishing-returns detection. */
export function updateFlatCount(ctx: LoopContext, newScore: number): number {
  const prev = ctx.session.iterations[ctx.session.iterations.length - 2]?.critique?.aggregateScore;
  if (prev === undefined) return 0;
  return newScore - prev < ctx.policy.minDeltaImprovement ? ctx.flatIterations + 1 : 0;
}

export function finalizeSession(session: Session, reason: string, finalArtifact?: Artifact, finalCritique?: Critique): Session {
  session.status = finalCritique && finalCritique.aggregateScore >= 80 ? "completed" : "terminated";
  session.endedAt = new Date().toISOString();
  session.terminationReason = reason;
  if (finalArtifact) session.finalArtifactId = finalArtifact.id;
  if (finalCritique) session.finalScore = finalCritique.aggregateScore;
  return session;
}
