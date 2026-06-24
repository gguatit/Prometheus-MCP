import { z } from "zod";

/**
 * MCP tool/prompt input schemas (zod v3 — the SDK 1.x peer).
 *
 * The SDK's `server.tool()` / `server.prompt()` require a RAW zod shape
 * (`Record<string, ZodTypeAny>`), not a `ZodObject` instance. So each schema is
 * exported as a raw `*Shape` (passed to the SDK) plus a `*Schema = z.object(...)`
 * wrapper (used for `z.infer` type derivation).
 */

const DOMAINS = [
  "web-design", "ui-design", "ux-design", "three-js", "react-three-fiber",
  "vfx", "interactive-experience", "frontend-animation", "game-development", "creative-coding",
] as const;
const KINDS = ["html", "jsx", "tsx", "js", "ts", "css", "json", "text", "markdown"] as const;
const PROVIDERS = ["stub", "openai", "deepseek", "minimax", "qwen", "glm", "claude"] as const;

// --- direct_creative_work ---
export const DirectCreativeWorkShape = {
  intent: z.string().min(3).max(2000).describe("What the user wants to create."),
  domain: z.enum(DOMAINS).optional().describe("Creative domain; auto-detected if omitted."),
  targetScore: z.number().min(0).max(100).optional().describe("Aggregate quality target (0-100)."),
  maxIterations: z.number().int().min(1).max(10).optional().describe("Max improvement iterations."),
  costBudgetUsd: z.number().min(0).optional().describe("Cost ceiling in USD."),
  provider: z.enum(PROVIDERS).optional().describe("Preferred provider."),
  seedArtifact: z.object({
    kind: z.enum(KINDS),
    content: z.string().max(200000),
    label: z.string().optional(),
  }).optional().describe("An existing artifact to improve instead of generating from scratch."),
  constraints: z.array(z.string()).optional().describe("Hard constraints."),
};
export const DirectCreativeWorkSchema = z.object(DirectCreativeWorkShape);
export type DirectCreativeWorkInput = z.infer<typeof DirectCreativeWorkSchema>;

// --- critique_artifact ---
export const CritiqueArtifactShape = {
  artifact: z.object({
    kind: z.enum(KINDS),
    content: z.string().max(200000),
    label: z.string().optional(),
  }),
  domain: z.enum(DOMAINS).optional(),
  patternId: z.string().optional(),
};
export const CritiqueArtifactSchema = z.object(CritiqueArtifactShape);
export type CritiqueArtifactInput = z.infer<typeof CritiqueArtifactSchema>;

// --- improve_artifact ---
export const ImproveArtifactShape = {
  artifact: z.object({
    kind: z.enum(KINDS),
    content: z.string().max(200000),
  }),
  critique: z.string().optional().describe("Optional prior critique JSON; if omitted a fresh critique is produced."),
  patternId: z.string().optional(),
  provider: z.enum(PROVIDERS).optional(),
};
export const ImproveArtifactSchema = z.object(ImproveArtifactShape);
export type ImproveArtifactInput = z.infer<typeof ImproveArtifactSchema>;

// --- list_patterns ---
export const ListPatternsShape = {
  category: z.string().optional(),
  query: z.string().optional(),
};
export const ListPatternsSchema = z.object(ListPatternsShape);
export type ListPatternsInput = z.infer<typeof ListPatternsSchema>;

// --- get_pattern ---
export const GetPatternShape = {
  patternId: z.string().min(1),
};
export const GetPatternSchema = z.object(GetPatternShape);
export type GetPatternInput = z.infer<typeof GetPatternSchema>;

// --- recall_sessions ---
export const RecallSessionsShape = {
  query: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
};
export const RecallSessionsSchema = z.object(RecallSessionsShape);
export type RecallSessionsInput = z.infer<typeof RecallSessionsSchema>;

// --- get_quality_trends ---
export const GetQualityTrendsShape = {
  since: z.string().optional().describe("ISO8601 date to trend from."),
  domain: z.enum(DOMAINS).optional(),
};
export const GetQualityTrendsSchema = z.object(GetQualityTrendsShape);
export type GetQualityTrendsInput = z.infer<typeof GetQualityTrendsSchema>;

// --- prompt shapes (server.prompt also wants a raw shape) ---
export const CritiqueThenImprovePromptShape = {
  artifact: z.string().min(10).describe("The artifact content to evaluate and improve."),
  kind: z.enum(KINDS).default("html"),
  domain: z.enum(DOMAINS).optional(),
};
export const GenerateFantasyVfxPromptShape = {
  effect: z.enum(["fireball", "lightning-spell", "magic-circle"]).describe("Which fantasy effect to generate."),
  targetScore: z.number().min(0).max(100).default(82),
};
export const AuditUiConsistencyPromptShape = {
  artifact: z.string().min(10),
};
export const ThreejsSceneReviewPromptShape = {
  artifact: z.string().min(10),
};
