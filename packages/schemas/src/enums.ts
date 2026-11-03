import { z } from "zod";

export const TicketTypeSchema = z.enum([
  "bug",
  "incident",
  "feature_request",
  "technical_debt",
  "clarification",
]);
export type TicketType = z.infer<typeof TicketTypeSchema>;

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const PrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const DecisionOptionSchema = z.enum([
  "accept",
  "defer",
  "split",
  "clarify",
  "duplicate",
]);
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const DecisionStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "clarified",
  "stale",
  "superseded",
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const EvidenceStateSchema = z.enum(["observed", "inferred", "unknown"]);
export type EvidenceState = z.infer<typeof EvidenceStateSchema>;

export const EntityTypeSchema = z.enum([
  "requirement",
  "task",
  "milestone",
  "ticket",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const RelationshipTypeSchema = z.enum([
  "implements",
  "depends_on",
  "validates",
  "blocks",
  "relates_to",
  "duplicate_of",
]);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

export const TaskStatusSchema = z.enum([
  "planned",
  "in_progress",
  "blocked",
  "done",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const ProjectRoleSchema = z.enum(["owner", "pm", "member", "viewer"]);
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

export const TicketStatusSchema = z.enum([
  "new",
  "analyzing",
  "analyzed",
  "needs_clarification",
  "accepted",
  "deferred",
  "rejected",
  "duplicate",
  "analysis_failed",
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const APPROVER_ROLES: ProjectRole[] = ["owner", "pm"];
