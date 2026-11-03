import { z } from "zod";
import { PrioritySchema, TicketTypeSchema } from "./enums.js";

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

export const RequirementDraftSchema = z.object({
  tempId: z.string().min(1).max(80),
  title: z.string().min(3).max(200),
  description: z.string().min(1).max(3000),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1).max(12),
  source: z.enum(["explicit", "inferred"]),
  status: z.enum(["proposed", "confirmed"]).default("proposed"),
});
export type RequirementDraft = z.infer<typeof RequirementDraftSchema>;

export const MilestoneDraftSchema = z.object({
  tempId: z.string().min(1).max(80),
  title: z.string().min(2).max(160),
  description: z.string().max(1000).optional().default(""),
  targetDate: IsoDateSchema.nullable().default(null),
  releaseGate: z.boolean().default(false),
});
export type MilestoneDraft = z.infer<typeof MilestoneDraftSchema>;

export const TaskDraftSchema = z.object({
  tempId: z.string().min(1).max(80),
  title: z.string().min(3).max(200),
  description: z.string().max(3000).default(""),
  requirementTempId: z.string().nullable().default(null),
  milestoneTempId: z.string().nullable().default(null),
  estimateDays: z.number().min(0.5).max(60),
  priority: PrioritySchema.default("P2"),
  ownerRole: z.string().min(2).max(80).default("Engineering"),
  dependencies: z.array(z.string()).default([]),
});
export type TaskDraft = z.infer<typeof TaskDraftSchema>;

export const RiskDraftSchema = z.object({
  title: z.string().min(3).max(200),
  severity: z.enum(["high", "medium", "low"]),
  mitigation: z.string().min(3).max(600),
});

export const PlanDraftSchema = z.object({
  name: z.string().min(2).max(160),
  goal: z.string().min(3).max(600),
  description: z.string().min(3).max(4000),
  startDate: IsoDateSchema,
  targetDate: IsoDateSchema.nullable(),
  requirements: z.array(RequirementDraftSchema).min(1).max(30),
  milestones: z.array(MilestoneDraftSchema).min(1).max(12),
  tasks: z.array(TaskDraftSchema).min(1).max(80),
  assumptions: z.array(z.string().min(1).max(500)).max(30).default([]),
  missingInformation: z.array(z.string().min(1).max(500)).max(30).default([]),
  risks: z.array(RiskDraftSchema).max(20).default([]),
});
export type PlanDraft = z.infer<typeof PlanDraftSchema>;

export const GeneratePlanInputSchema = z.object({
  name: z.string().min(2).max(160),
  goal: z.string().min(3).max(600),
  description: z.string().min(10).max(8000),
  startDate: IsoDateSchema,
  targetDate: IsoDateSchema.nullable().optional(),
  constraints: z
    .object({
      team: z.string().max(300).optional(),
      capacityPersonDays: z.number().min(1).max(10000).optional(),
      technology: z.string().max(1000).optional(),
      nonNegotiables: z.string().max(2000).optional(),
    })
    .default({}),
});
export type GeneratePlanInput = z.infer<typeof GeneratePlanInputSchema>;

export const GeneratedPlanSchema = z.object({
  draft: PlanDraftSchema,
  provider: z.enum(["gemini", "meta", "deterministic-demo"]),
  model: z.string(),
  degraded: z.boolean(),
  notice: z.string().nullable(),
  latencyMs: z.number(),
  usage: z
    .object({
      inputTokens: z.number().nullable(),
      outputTokens: z.number().nullable(),
    })
    .nullable(),
});
export type GeneratedPlan = z.infer<typeof GeneratedPlanSchema>;

export const PlanValidationSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  cycles: z.array(z.array(z.string())),
});
export type PlanValidation = z.infer<typeof PlanValidationSchema>;

export const CreateProjectInputSchema = z.object({
  draft: PlanDraftSchema,
  generation: z
    .object({
      provider: z.enum(["gemini", "meta", "deterministic-demo"]),
      model: z.string(),
      degraded: z.boolean(),
    })
    .optional(),
  constraints: GeneratePlanInputSchema.shape.constraints.optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const ModelPlanDraftSchema = PlanDraftSchema;

export const CreateTicketInputSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(4).max(240),
  description: z.string().min(10).max(8000),
  source: z.string().min(2).max(80).default("manual"),
  ticketType: TicketTypeSchema.nullable().optional(),
  affectedComponent: z.string().max(200).optional().default(""),
  reportedImpact: z.string().max(2000).optional().default(""),
  evidence: z.string().max(5000).optional().default(""),
  reporter: z.string().max(160).optional().default(""),
  environment: z.string().max(120).optional().default(""),
  severityReported: z.enum(["critical", "high", "medium", "low", "unspecified"]).default("unspecified"),
});
export type CreateTicketInput = z.infer<typeof CreateTicketInputSchema>;
