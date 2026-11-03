export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  goal: string;
  start_date: string;
  target_date: string | null;
  status: string;
  constraints_json: Record<string, unknown>;
  current_plan_version: number;
  created_at: string;
  created_by: string | null;
}

export interface RequirementRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  source: string;
  status: string;
}

export interface MilestoneRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  target_date: string | null;
  release_gate: boolean;
  status: string;
  position: number;
}

export interface TaskRow {
  id: string;
  project_id: string;
  requirement_id: string | null;
  milestone_id: string | null;
  title: string;
  description: string;
  status: string;
  estimate_days: string | number;
  priority: string;
  owner_role: string;
  planned_start: string | null;
  planned_finish: string | null;
  source_ticket_id: string | null;
}

export interface DependencyRow {
  predecessor_task_id: string;
  successor_task_id: string;
  dependency_type: string;
}

export interface VersionRow {
  id: string;
  project_id: string;
  version_number: number;
  parent_version_id: string | null;
  snapshot_json: PlanSnapshot;
  change_summary: string;
  created_by: string | null;
  created_at: string;
  approved_by_name?: string | null;
}

export interface TicketRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  source: string;
  ticket_type: string | null;
  affected_component: string;
  reported_impact: string;
  evidence: string;
  reporter: string;
  environment: string;
  severity_reported: string;
  status: string;
  created_by: string | null;
  created_at: string;
  analyzed_at: string | null;
}

export interface ProposalRow {
  id: string;
  ticket_id: string;
  project_id: string;
  base_plan_version: number;
  recommendation: string;
  summary: string;
  classification_json: Record<string, unknown>;
  policy_json: Record<string, unknown>;
  evidence_json: unknown[];
  unknowns_json: string[];
  clarifying_questions_json: string[];
  related_records_json: unknown[];
  duplicate_candidates_json: unknown[];
  proposed_changes_json: Record<string, unknown>;
  recommendation_rationale: string;
  status: string;
  model_provider: string;
  model_name: string;
  model_meta_json: Record<string, unknown> | null;
  created_at: string;
}

export interface ScenarioRow {
  id: string;
  proposal_id: string;
  option: string;
  label: string;
  input_hash: string;
  output_json: Record<string, unknown>;
  valid: boolean;
  validation_errors_json: string[];
  created_at: string;
}

export interface PlanSnapshot {
  version: number;
  generatedAt: string;
  project: {
    name: string;
    goal: string;
    description: string;
    startDate: string;
    targetDate: string | null;
    constraints: Record<string, unknown>;
  };
  requirements: Array<{
    id: string;
    title: string;
    description: string;
    acceptanceCriteria: string[];
    source: string;
    status: string;
  }>;
  milestones: Array<{
    id: string;
    title: string;
    description: string;
    targetDate: string | null;
    releaseGate: boolean;
    status: string;
    position: number;
  }>;
  tasks: Array<{
    id: string;
    requirementId: string | null;
    milestoneId: string | null;
    title: string;
    description: string;
    status: string;
    estimateDays: number;
    priority: string;
    ownerRole: string;
    plannedStart: string | null;
    plannedFinish: string | null;
    sourceTicketId: string | null;
  }>;
  dependencies: Array<{
    predecessorId: string;
    successorId: string;
    dependencyType: string;
  }>;
  assumptions: string[];
  missingInformation: string[];
}
