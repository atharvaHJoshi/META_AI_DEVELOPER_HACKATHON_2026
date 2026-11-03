import type {
  PlanDraft,
  ProjectConstraints,
  TicketAnalysis,
} from "@miraiwerk/schemas";

export type AiProvider = "gemini" | "meta" | "deterministic-demo";

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface PlanGenerationResult {
  draft: PlanDraft;
  provider: AiProvider;
  model: string;
  degraded: boolean;
  notice: string | null;
  latencyMs: number;
  usage: Usage | null;
}

export interface TicketAnalysisResult {
  analysis: TicketAnalysis;
  provider: AiProvider;
  model: string;
  degraded: boolean;
  notice: string | null;
  latencyMs: number;
  usage: Usage | null;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

export interface AnalysisProject {
  id: string;
  name: string;
  description: string;
  goal: string;
  startDate: string;
  targetDate: string | null;
  planVersion: number;
  constraints: ProjectConstraints;
  currentPlanAssumptions: string[];
}

export interface AnalysisRequirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

export interface AnalysisTask {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  estimateDays: number;
  requirementId: string | null;
  milestoneId: string | null;
  milestoneTitle: string | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  downstreamTaskIds: string[];
  upstreamTaskIds: string[];
}

export interface AnalysisMilestone {
  id: string;
  title: string;
  targetDate: string | null;
  releaseGate: boolean;
}

export interface AnalysisTicket {
  id: string;
  title: string;
  description: string;
  source: string;
  affectedComponent: string;
  reportedImpact: string;
  evidence: string;
  reporter: string;
  environment: string;
  severityReported: string;
  createdAt: string;
}

export interface AnalysisContext {
  project: AnalysisProject;
  requirements: AnalysisRequirement[];
  milestones: AnalysisMilestone[];
  tasks: AnalysisTask[];
  relatedTickets: Array<{
    id: string;
    title: string;
    description: string;
    ticketType: string | null;
    status: string;
    createdAt: string;
  }>;
  ticket: AnalysisTicket;
}

export interface AiCallRecord {
  workflow: "plan_generation" | "ticket_analysis" | "assistant";
  provider: AiProvider;
  model: string;
  durationMs: number;
  success: boolean;
  degraded: boolean;
  error: string | null;
  usage: Usage | null;
  projectId: string | null;
}

export interface PlanInput {
  name: string;
  goal: string;
  description: string;
  startDate: string;
  targetDate: string | null;
  constraints: {
    team?: string;
    capacityPersonDays?: number;
    technology?: string;
    nonNegotiables?: string;
  };
}

export interface PlanDraftValidation {
  draft: PlanDraft;
  errors: string[];
  warnings: string[];
}
