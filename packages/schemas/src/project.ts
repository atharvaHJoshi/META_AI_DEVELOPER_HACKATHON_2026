import { z } from "zod";
import { ProjectRoleSchema, TicketTypeSchema, DecisionOptionSchema, DecisionStatusSchema, PrioritySchema, TaskStatusSchema } from "./enums.js";
import { ProjectConstraintsSchema } from "./simulation.js";
import { AuthUserSchema, OrganizationSchema, WorkspaceSchema } from "./platform.js";

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string(),
  avatarColor: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const ProjectMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  title: z.string(),
  role: ProjectRoleSchema,
  avatarColor: z.string(),
});
export type ProjectMember = z.infer<typeof ProjectMemberSchema>;

export const RequirementSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  source: z.string(),
  status: z.string(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const MilestoneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  targetDate: z.string().nullable(),
  releaseGate: z.boolean(),
  status: z.string(),
  position: z.number(),
  description: z.string().default(""),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export const ProjectTaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  requirementId: z.string().nullable(),
  milestoneId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  status: TaskStatusSchema,
  estimateDays: z.number(),
  priority: PrioritySchema,
  ownerRole: z.string(),
  plannedStart: z.string().nullable(),
  plannedFinish: z.string().nullable(),
  sourceTicketId: z.string().nullable(),
});
export type ProjectTask = z.infer<typeof ProjectTaskSchema>;

export const ProjectDependencySchema = z.object({
  predecessorId: z.string(),
  successorId: z.string(),
  dependencyType: z.string(),
});
export type ProjectDependency = z.infer<typeof ProjectDependencySchema>;

export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  goal: z.string(),
  startDate: z.string(),
  targetDate: z.string().nullable(),
  status: z.string(),
  currentPlanVersion: z.number(),
  createdAt: z.string(),
  role: ProjectRoleSchema,
  memberCount: z.number(),
  openTicketCount: z.number(),
  pendingDecisionCount: z.number(),
  milestoneCount: z.number(),
  taskCount: z.number(),
  nextMilestone: z
    .object({
      id: z.string(),
      title: z.string(),
      targetDate: z.string().nullable(),
      releaseGate: z.boolean(),
    })
    .nullable(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const PlanVersionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  versionNumber: z.number(),
  parentVersionId: z.string().nullable(),
  changeSummary: z.string(),
  approvedBy: z.string().nullable(),
  approvedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type PlanVersion = z.infer<typeof PlanVersionSchema>;

export const ProjectPlanSchema = z.object({
  project: ProjectSummarySchema,
  version: z.number(),
  requirements: z.array(RequirementSchema),
  milestones: z.array(MilestoneSchema),
  tasks: z.array(ProjectTaskSchema),
  dependencies: z.array(ProjectDependencySchema),
  members: z.array(ProjectMemberSchema),
  constraints: ProjectConstraintsSchema,
  assumptions: z.array(z.string()),
  missingInformation: z.array(z.string()),
  validation: z
    .object({
      valid: z.boolean(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()),
      cycle: z.array(z.string()).nullable(),
    })
    .nullable(),
});
export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;

export const TicketListItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  ticketType: TicketTypeSchema.nullable(),
  status: z.string(),
  severityReported: z.string(),
  createdAt: z.string(),
  latestDecisionId: z.string().nullable(),
  latestDecisionStatus: DecisionStatusSchema.nullable(),
  latestRecommendation: DecisionOptionSchema.nullable(),
  latestPriority: PrioritySchema.nullable(),
  missingEvidenceCount: z.number(),
});
export type TicketListItem = z.infer<typeof TicketListItemSchema>;

export const DecisionHistoryItemSchema = z.object({
  id: z.string(),
  decisionId: z.string(),
  action: z.string(),
  actorName: z.string().nullable(),
  reason: z.string(),
  timestamp: z.string(),
  ticketId: z.string().nullable(),
  ticketTitle: z.string().nullable(),
  option: DecisionOptionSchema.nullable(),
});

export type DecisionHistoryItem = z.infer<typeof DecisionHistoryItemSchema>;

export const ProjectHistorySchema = z.object({
  versions: z.array(PlanVersionSchema),
  decisions: z.array(DecisionHistoryItemSchema),
  auditEvents: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      entityType: z.string(),
      entityId: z.string(),
      actorName: z.string().nullable(),
      timestamp: z.string(),
      summary: z.string(),
    }),
  ),
});
export type ProjectHistory = z.infer<typeof ProjectHistorySchema>;

export const AppBootstrapSchema = z.object({
  users: z.array(UserSchema),
  projects: z.array(ProjectSummarySchema),
  currentUser: AuthUserSchema.nullable().optional(),
  organizations: z.array(OrganizationSchema).default([]),
  workspaces: z.array(WorkspaceSchema).default([]),
  activeWorkspaceId: z.string().nullable().default(null),
  aiMode: z.object({
    provider: z.enum(["gemini", "meta", "deterministic-demo"]),
    model: z.string(),
    usesMeta: z.boolean().default(false),
    usesGemini: z.boolean().default(false),
    label: z.string(),
  }),
  ticketCounts: z.object({
    open: z.number(),
    pendingDecisions: z.number(),
    approvedDecisions: z.number(),
  }),
});
export type AppBootstrap = z.infer<typeof AppBootstrapSchema>;

export const ApproveDecisionInputSchema = z.object({
  option: DecisionOptionSchema,
  reason: z.string().max(1000).default(""),
});
export const RejectDecisionInputSchema = z.object({
  reason: z.string().min(3).max(1000),
});
