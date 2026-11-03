/**
 * MIRAIWERK AIML — the analysis layer.
 *
 * The package owns model orchestration, prompts, deterministic fallback rules
 * and the policy that turns a proposal into an explainable classification.
 * It does not touch the database or the HTTP layer.
 */

export { DETERMINISTIC_MODEL, getMetaConfig, hasMetaKey } from "./config.js";
export { getGeminiConfig, hasGeminiKey } from "./config.js";
export type { GeminiConfig, MetaConfig } from "./config.js";
export { applyPolicy } from "./policy.js";
export {
  metaAnalyzeTicket,
  metaGeneratePlan,
  MetaError,
} from "./providers/meta.js";
export {
  geminiAnalyzeTicket,
  geminiAssist,
  geminiGeneratePlan,
  GeminiError,
} from "./providers/gemini.js";
export type { AssistResult } from "./providers/gemini.js";
export {
  demoAnalyzeTicket,
  demoRelatedTickets,
} from "./rules/analyzer.js";
export {
  commercePlan,
  demoPlan,
  genericPlan,
  isCommerceBrief,
} from "./rules/templates.js";
export {
  planDraftGeminiSchema,
  planDraftJsonSchema,
  ticketAnalysisGeminiSchema,
  ticketAnalysisJsonSchema,
} from "./schemaJson.js";
export type {
  AnalysisContext,
  AnalysisProject,
  AnalysisRequirement,
  AnalysisTask,
  AnalysisTicket,
  AiProvider,
  PlanGenerationResult,
  PlanInput,
  TicketAnalysisResult,
  Usage,
} from "./types.js";
