import { z } from "zod";
import {
  DecisionOptionSchema,
  DecisionStatusSchema,
  EntityTypeSchema,
  EvidenceStateSchema,
  PrioritySchema,
  RelationshipTypeSchema,
  SeveritySchema,
  TicketStatusSchema,
  TicketTypeSchema,
} from "./enums.js";
import { ProposedChangeSchema } from "./simulation.js";

export const RelatedRecordSchema = z.object({
  entityType: EntityTypeSchema,
  entityId: z.string().min(1),
  relationshipType: RelationshipTypeSchema,
  evidenceState: EvidenceStateSchema,
  rationale: z.string().min(3).max(800),
});
export type RelatedRecord = z.infer<typeof RelatedRecordSchema>;

export const EvidenceItemSchema = z.object({
  claim: z.string().min(3).max(800),
  state: EvidenceStateSchema,
  sourceType: z.enum(["ticket", "project", "policy", "model"]),
  sourceId: z.string().nullable(),
  excerpt: z.string().max(800).nullable(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const DuplicateCandidateSchema = z.object({
  ticketId: z.string().min(1),
  rationale: z.string().min(3).max(600),
  evidenceState: EvidenceStateSchema,
});
export type DuplicateCandidate = z.infer<typeof DuplicateCandidateSchema>;

export const TicketClassificationSchema = z.object({
  ticketType: TicketTypeSchema,
  priority: PrioritySchema,
  urgency: SeveritySchema,
  summary: z.string().min(3).max(800),
  businessImpact: z.string().min(3).max(1000),
  customerImpact: z.string().max(1000).default(""),
});
export type TicketClassification = z.infer<typeof TicketClassificationSchema>;

export const TicketAnalysisSchema = z.object({
  classification: TicketClassificationSchema,
  relatedRecords: z.array(RelatedRecordSchema).max(20).default([]),
  duplicateCandidates: z.array(DuplicateCandidateSchema).max(5).default([]),
  evidence: z.array(EvidenceItemSchema).max(20).default([]),
  unknowns: z.array(z.string().min(2).max(500)).max(15).default([]),
  clarifyingQuestions: z.array(z.string().min(3).max(500)).max(10).default([]),
  recommendedOption: DecisionOptionSchema,
  recommendationRationale: z.string().min(5).max(2000),
  proposedChanges: z.object({
    accept: ProposedChangeSchema,
    split: ProposedChangeSchema.nullable().default(null),
  }),
});
export type TicketAnalysis = z.infer<typeof TicketAnalysisSchema>;

export const TicketSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string(),
  source: z.string(),
  ticketType: TicketTypeSchema.nullable(),
  affectedComponent: z.string(),
  reportedImpact: z.string(),
  evidence: z.string(),
  reporter: z.string(),
  environment: z.string(),
  severityReported: z.string(),
  status: TicketStatusSchema,
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  analyzedAt: z.string().nullable(),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const TicketLinkSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  entityType: EntityTypeSchema,
  entityId: z.string(),
  entityLabel: z.string().nullable(),
  relationshipType: RelationshipTypeSchema,
  evidenceState: EvidenceStateSchema,
  rationale: z.string(),
  confirmed: z.boolean(),
});
export type TicketLink = z.infer<typeof TicketLinkSchema>;

export const PolicyOutcomeSchema = z.object({
  modelPriority: PrioritySchema,
  finalPriority: PrioritySchema,
  responseWindowHours: z.number(),
  responseWindowLabel: z.string(),
  rulesApplied: z.array(z.string()),
  escalated: z.boolean(),
});
export type PolicyOutcome = z.infer<typeof PolicyOutcomeSchema>;

export const DecisionProposalSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  projectId: z.string(),
  basePlanVersion: z.number(),
  recommendation: DecisionOptionSchema,
  summary: z.string(),
  classification: TicketClassificationSchema,
  policy: PolicyOutcomeSchema,
  evidence: z.array(EvidenceItemSchema),
  unknowns: z.array(z.string()),
  clarifyingQuestions: z.array(z.string()),
  relatedRecords: z.array(RelatedRecordSchema),
  duplicateCandidates: z.array(DuplicateCandidateSchema),
  proposedChanges: z.object({
    accept: ProposedChangeSchema,
    split: ProposedChangeSchema.nullable(),
  }),
  status: DecisionStatusSchema,
  modelProvider: z.enum(["gemini", "meta", "deterministic-demo"]),
  modelName: z.string(),
  modelMeta: z
    .object({
      degraded: z.boolean(),
      latencyMs: z.number(),
      notice: z.string().nullable(),
    })
    .nullable(),
  recommendationRationale: z.string(),
  createdAt: z.string(),
  scenarioRuns: z.array(
    z.object({
      id: z.string(),
      option: DecisionOptionSchema,
      label: z.string(),
      valid: z.boolean(),
      output: z.unknown(),
      inputHash: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export type DecisionProposal = z.infer<typeof DecisionProposalSchema>;

export const DecisionAuditSchema = z.object({
  id: z.string(),
  decisionId: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  reason: z.string(),
  beforeJson: z.unknown().nullable(),
  afterJson: z.unknown().nullable(),
  timestamp: z.string(),
});
export type DecisionAudit = z.infer<typeof DecisionAuditSchema>;

export const TicketDetailSchema = z.object({
  ticket: TicketSchema,
  links: z.array(TicketLinkSchema),
  proposal: DecisionProposalSchema.nullable(),
  audits: z.array(DecisionAuditSchema),
});
export type TicketDetail = z.infer<typeof TicketDetailSchema>;

export const DecisionOutcomeSchema = z.object({
  proposal: DecisionProposalSchema,
  scenario: z.unknown().nullable(),
  planVersionNumber: z.number().nullable(),
  audit: DecisionAuditSchema,
  message: z.string(),
});
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;

export const ClarifyDecisionInputSchema = z.object({
  reason: z.string().min(3).max(1000),
  questions: z.array(z.string().min(3).max(500)).max(10).default([]),
});
export type ClarifyDecisionInput = z.infer<typeof ClarifyDecisionInputSchema>;
