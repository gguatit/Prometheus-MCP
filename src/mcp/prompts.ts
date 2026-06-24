import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CritiqueThenImprovePromptShape, GenerateFantasyVfxPromptShape,
  AuditUiConsistencyPromptShape, ThreejsSceneReviewPromptShape,
} from "./schemas.js";

/**
 * registerPrompts — opinionated workflow templates that compose the tools.
 * Prompts encode workflow, not logic; logic stays in tools.
 */
export function registerPrompts(server: McpServer): void {
  server.prompt(
    "critique-then-improve",
    "Two-step workflow: critique an existing artifact, then improve it. Use when you already have output and want it elevated.",
    CritiqueThenImprovePromptShape,
    ({ artifact, kind, domain }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `First, call critique_artifact with this artifact (kind=${kind}${domain ? `, domain=${domain}` : ""}):\n\n${artifact}\n\nThen, using the returned critique, call improve_artifact to produce a revised, higher-quality version. Report the score improvement.` },
        },
      ],
    }),
  );

  server.prompt(
    "generate-fantasy-vfx",
    "Generate a fantasy visual effect (fireball / lightning / magic circle) with expert creative direction and iterative quality improvement.",
    GenerateFantasyVfxPromptShape,
    ({ effect, targetScore }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Call direct_creative_work with intent "create a ${effect} visual effect for the web" and targetScore ${targetScore}. Use the matching pattern from the pattern library. Return the final artifact and its critique.` },
        },
      ],
    }),
  );

  server.prompt(
    "audit-ui-consistency",
    "Audit a UI artifact for design consistency (fonts, spacing, color system) and produce an expert critique with prioritized fixes.",
    AuditUiConsistencyPromptShape,
    ({ artifact }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Call critique_artifact with kind=html on this UI and review the design-consistency, readability, and modern-design-practices dimensions. Summarize the top 3 prioritized fixes:\n\n${artifact}` },
        },
      ],
    }),
  );

  server.prompt(
    "threejs-scene-review",
    "Review a Three.js / React Three Fiber scene for technical quality, performance, and animation quality; then improve it.",
    ThreejsSceneReviewPromptShape,
    ({ artifact }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Call critique_artifact with kind=js on this Three.js scene, focusing on technical-quality, performance, and animation-quality. Then call improve_artifact to produce a refined version:\n\n${artifact}` },
        },
      ],
    }),
  );
}
