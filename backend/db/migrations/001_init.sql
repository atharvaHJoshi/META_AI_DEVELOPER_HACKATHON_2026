-- MIRAIWERK initial schema
-- PostgreSQL 16. IDs are application-generated text values so seeded demo
-- records and API-created records use the same representation.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#5B6CFF',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  start_date DATE NOT NULL,
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  constraints_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_plan_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'pm', 'member', 'viewer')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS plan_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  parent_version_id TEXT REFERENCES plan_versions(id) ON DELETE SET NULL,
  snapshot_json JSONB NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_number)
);

CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'generated',
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_date DATE,
  release_gate BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'planned',
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requirement_id TEXT REFERENCES requirements(id) ON DELETE SET NULL,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  estimate_days NUMERIC(6, 1) NOT NULL,
  priority TEXT NOT NULL DEFAULT 'P2',
  owner_role TEXT NOT NULL DEFAULT 'Engineering',
  planned_start DATE,
  planned_finish DATE,
  source_ticket_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  predecessor_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL DEFAULT 'finishes_to_start',
  PRIMARY KEY (predecessor_task_id, successor_task_id),
  CHECK (predecessor_task_id <> successor_task_id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  ticket_type TEXT,
  affected_component TEXT NOT NULL DEFAULT '',
  reported_impact TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  reporter TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  severity_reported TEXT NOT NULL DEFAULT 'unspecified',
  status TEXT NOT NULL DEFAULT 'new',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  analyzed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ticket_links (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  evidence_state TEXT NOT NULL DEFAULT 'inferred',
  rationale TEXT NOT NULL DEFAULT '',
  confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_proposals (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  base_plan_version INTEGER NOT NULL,
  recommendation TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  classification_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  unknowns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  clarifying_questions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_records_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  duplicate_candidates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_changes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendation_rationale TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  model_provider TEXT NOT NULL DEFAULT 'deterministic-demo',
  model_name TEXT NOT NULL DEFAULT '',
  model_meta_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenario_runs (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES decision_proposals(id) ON DELETE CASCADE,
  option TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  input_hash TEXT NOT NULL,
  output_json JSONB NOT NULL,
  valid BOOLEAN NOT NULL DEFAULT false,
  validation_errors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_audit (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decision_proposals(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  before_json JSONB,
  after_json JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  summary TEXT NOT NULL DEFAULT '',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  workflow TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT false,
  degraded BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  usage_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id);
CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_links_ticket ON ticket_links(ticket_id);
CREATE INDEX IF NOT EXISTS idx_proposals_ticket ON decision_proposals(ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_project ON decision_proposals(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenarios_proposal ON scenario_runs(proposal_id);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_events(project_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_decision_audit_decision ON decision_audit(decision_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ai_calls_project ON ai_calls(project_id, created_at DESC);
