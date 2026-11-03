import { z } from "zod";
import {
  DecisionOptionSchema,
  PrioritySchema,
  TaskStatusSchema,
} from "./enums.js";

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

export const ProjectPolicySchema = z.object({
  criticalResponseHours: z.number().min(1).max(720).default(24),
  highResponseDays: z.number().min(1).max(90).default(3),
  normalResponseDays: z.number().min(1).max(180).default(10),
  requireEvidenceForP0: z.boolean().default(true),
  escalationComponents: z.array(z.string()).default([]),
  releaseFreezeDays: z.number().min(0).max(60).default(3),
});
export type ProjectPolicy = z.infer<typeof ProjectPolicySchema>;

export const ProjectConstraintsSchema = z.object({
  team: z.string().optional(),
  capacityPersonDays: z.number().min(1).nullable().optional(),
  workingDaysAvailable: z.number().min(1).nullable().optional(),
  technology: z.string().optional(),
  nonNegotiables: z.string().optional(),
  policy: ProjectPolicySchema.optional(),
});
export type ProjectConstraints = z.infer<typeof ProjectConstraintsSchema>;

export const GraphTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  requirementId: z.string().nullable().default(null),
  milestoneId: z.string().nullable().default(null),
  estimateDays: z.number().min(0.5).max(60),
  priority: PrioritySchema.default("P2"),
  status: TaskStatusSchema.default("planned"),
  ownerRole: z.string().default("Engineering"),
  plannedStart: IsoDateSchema.nullable().default(null),
  plannedFinish: IsoDateSchema.nullable().default(null),
  sourceTicketId: z.string().nullable().default(null),
});
export type GraphTask = z.infer<typeof GraphTaskSchema>;

export const GraphMilestoneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  targetDate: IsoDateSchema.nullable().default(null),
  releaseGate: z.boolean().default(false),
});
export type GraphMilestone = z.infer<typeof GraphMilestoneSchema>;

export const GraphDependencySchema = z.object({
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  dependencyType: z.string().default("finishes_to_start"),
});
export type GraphDependency = z.infer<typeof GraphDependencySchema>;

export const ProjectGraphSchema = z.object({
  projectId: z.string().min(1),
  startDate: IsoDateSchema,
  targetDate: IsoDateSchema.nullable().default(null),
  tasks: z.array(GraphTaskSchema).max(300),
  milestones: z.array(GraphMilestoneSchema).max(40),
  dependencies: z.array(GraphDependencySchema).max(1000),
  constraints: ProjectConstraintsSchema.default({}),
});
export type ProjectGraph = z.infer<typeof ProjectGraphSchema>;

export const ProposedTaskAddSchema = z.object({
  tempId: z.string().min(1).max(100),
  title: z.string().min(3).max(200),
  description: z.string().max(3000).default(""),
  requirementId: z.string().nullable().default(null),
  milestoneId: z.string().nullable().default(null),
  estimateDays: z.number().min(0.5).max(60),
  priority: PrioritySchema.default("P1"),
  ownerRole: z.string().min(2).max(80).default("Engineering"),
  dependencies: z.array(z.string()).default([]),
});
export type ProposedTaskAdd = z.infer<typeof ProposedTaskAddSchema>;

export const ProposedTaskUpdateSchema = z.object({
  taskId: z.string().min(1),
  estimateDays: z.number().min(0.5).max(60).optional(),
  priority: PrioritySchema.optional(),
  milestoneId: z.string().nullable().optional(),
});
export type ProposedTaskUpdate = z.infer<typeof ProposedTaskUpdateSchema>;

export const ProposedDependencyAddSchema = z.object({
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  dependencyType: z.string().default("finishes_to_start"),
});

export const ProposedChangeSchema = z.object({
  option: DecisionOptionSchema,
  tasksToAdd: z.array(ProposedTaskAddSchema).max(20).default([]),
  tasksToUpdate: z.array(ProposedTaskUpdateSchema).max(20).default([]),
  tasksToRemove: z.array(z.string()).max(10).default([]),
  dependenciesToAdd: z.array(ProposedDependencyAddSchema).max(30).default([]),
  assumptions: z.array(z.string().max(500)).max(20).default([]),
  rationale: z.string().max(1200).default(""),
});
export type ProposedChange = z.infer<typeof ProposedChangeSchema>;

export const PolicyFindingSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]),
  code: z.string(),
  message: z.string(),
});
export type PolicyFinding = z.infer<typeof PolicyFindingSchema>;

export const FieldChangeSchema = z.object({
  field: z.string(),
  before: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  after: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

export const TaskDiffSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  changes: z.array(FieldChangeSchema),
});

export const MilestoneDeltaSchema = z.object({
  milestoneId: z.string(),
  title: z.string(),
  targetDate: IsoDateSchema.nullable(),
  baselineDate: IsoDateSchema.nullable(),
  simulatedDate: IsoDateSchema.nullable(),
  deltaDays: z.number(),
  targetDeltaDays: z.number().nullable(),
  releaseGate: z.boolean(),
  breached: z.boolean(),
});

export const PlanDiffSchema = z.object({
  addedTasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      milestoneId: z.string().nullable(),
      estimateDays: z.number(),
      plannedStart: IsoDateSchema.nullable(),
      plannedFinish: IsoDateSchema.nullable(),
    }),
  ),
  changedTasks: z.array(TaskDiffSchema),
  removedTasks: z.array(z.object({ taskId: z.string(), title: z.string() })),
  addedDependencies: z.array(
    z.object({
      predecessorId: z.string(),
      successorId: z.string(),
      dependencyType: z.string(),
    }),
  ),
  milestoneDeltas: z.array(MilestoneDeltaSchema),
  criticalPathTaskIds: z.array(z.string()),
  targetMilestoneId: z.string().nullable(),
  targetDeltaDays: z.number(),
});
export type PlanDiff = z.infer<typeof PlanDiffSchema>;

export const ScenarioMetricsSchema = z.object({
  tasksAdded: z.number(),
  tasksChanged: z.number(),
  tasksRemoved: z.number(),
  dependenciesAdded: z.number(),
  effortAddedDays: z.number(),
  scheduleDeltaDays: z.number(),
  milestonesShifted: z.number(),
  milestonesBreached: z.number(),
  affectedTaskCount: z.number(),
  totalEffortDays: z.number(),
});
export type ScenarioMetrics = z.infer<typeof ScenarioMetricsSchema>;

export const ScheduledTaskSchema = GraphTaskSchema.extend({
  plannedStart: IsoDateSchema,
  plannedFinish: IsoDateSchema,
  onCriticalPath: z.boolean().default(false),
  slackDays: z.number().default(0),
  impacted: z.boolean().default(false),
});
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;

export const ScheduledMilestoneSchema = GraphMilestoneSchema.extend({
  computedDate: IsoDateSchema,
  baselineComputedDate: IsoDateSchema.nullable().default(null),
  deltaDays: z.number().default(0),
  targetDeltaDays: z.number().nullable().default(null),
  breached: z.boolean().default(false),
});
export type ScheduledMilestone = z.infer<typeof ScheduledMilestoneSchema>;

export const ScenarioResultSchema = z.object({
  option: DecisionOptionSchema,
  label: z.string(),
  valid: z.boolean(),
  validationErrors: z.array(z.string()),
  validationWarnings: z.array(z.string()),
  diff: PlanDiffSchema,
  metrics: ScenarioMetricsSchema,
  tasks: z.array(ScheduledTaskSchema),
  milestones: z.array(ScheduledMilestoneSchema),
  affectedTaskIds: z.array(z.string()),
  affectedMilestoneIds: z.array(z.string()),
  policyFindings: z.array(PolicyFindingSchema),
  assumptions: z.array(z.string()),
  capacity: z
    .object({
      statedCapacityPersonDays: z.number().nullable(),
      scheduledEffortDays: z.number(),
      utilizationPercent: z.number().nullable(),
      note: z.string(),
    })
    .nullable(),
  inputHash: z.string(),
  computedAt: z.string(),
});
export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;

export const SimulationRequestSchema = z.object({
  option: DecisionOptionSchema,
  baselineVersion: z.number().int().min(1).optional(),
});
export type SimulationRequest = z.infer<typeof SimulationRequestSchema>;
