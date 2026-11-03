-- MIRAIWERK AI unified platform migration.
-- Adds Nirnaya-derived identity, organizations, workspaces, teams,
-- collaboration records and project scoping on top of the MIRAIWERK schema.
-- Additive only: existing projects, plans, tickets and audits are preserved.

-- ---------------------------------------------------------------------------
-- Identity extensions. Passwords live apart from profile data.
-- ---------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended')),
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

-- ---------------------------------------------------------------------------
-- Organizations and workspaces. Both use application-generated TEXT ids so
-- they interoperate with existing MIRAIWERK project and user ids.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'manager', 'member', 'viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members (user_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  description      TEXT NOT NULL DEFAULT '',
  onboarding_stage INTEGER NOT NULL DEFAULT 1,
  onboarding_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_context_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_org ON workspaces (organization_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'manager', 'member', 'viewer')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Sessions: opaque refresh tokens are stored as SHA-256 digests. Rotation
-- links a replacement to its predecessor so replay can revoke the family.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id      TEXT NOT NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  rotated_to     TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  user_agent     TEXT NOT NULL DEFAULT '',
  ip_address     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions (family_id);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL CHECK (provider IN ('meta', 'google', 'microsoft')),
  provider_user_id   TEXT NOT NULL,
  email_at_provider  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at      TIMESTAMPTZ,
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS one_time_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (purpose, token_hash)
);

CREATE TABLE IF NOT EXISTS security_audit (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  outcome    TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  ip_address TEXT,
  user_agent TEXT NOT NULL DEFAULT '',
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_action ON security_audit (action, created_at DESC);

-- ---------------------------------------------------------------------------
-- Tenant scoping for projects. Legacy rows are linked to a default workspace
-- by the seed script and by the migration backfill below.
-- ---------------------------------------------------------------------------
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects (organization_id);

-- ---------------------------------------------------------------------------
-- Teams and workload inputs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  lead_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id  TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS labels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee_id);

-- ---------------------------------------------------------------------------
-- Documentation, diagrams, meetings and discussion threads.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  doc_type     TEXT NOT NULL DEFAULT 'markdown'
    CHECK (doc_type IN ('markdown', 'diagram')),
  content      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft',
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS meetings (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  agenda           TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  scheduled_at     TIMESTAMPTZ,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status           TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  summary          TEXT NOT NULL DEFAULT '',
  action_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_workspace ON meetings (workspace_id, scheduled_at DESC);

CREATE TABLE IF NOT EXISTS forum_threads (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'general',
  solved       BOOLEAN NOT NULL DEFAULT false,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forum_replies (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forum_replies_thread ON forum_replies (thread_id, created_at);

-- AI telemetry gains tenant scope.
ALTER TABLE ai_calls
  ADD COLUMN IF NOT EXISTS organization_id TEXT,
  ADD COLUMN IF NOT EXISTS workspace_id TEXT;

-- ---------------------------------------------------------------------------
-- Backfill: every pre-existing user without a workspace gets a personal
-- organization/workspace so the unified app never exposes an orphan project.
-- The application seed performs the richer demo setup.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  u RECORD;
  org_id TEXT;
  ws_id TEXT;
BEGIN
  FOR u IN SELECT id, name, email FROM users LOOP
    IF NOT EXISTS (
      SELECT 1 FROM workspace_members wm WHERE wm.user_id = u.id
    ) THEN
      org_id := 'org_' || substr(md5(u.id), 1, 20);
      ws_id := 'ws_' || substr(md5(u.id || 'workspace'), 1, 20);
      INSERT INTO organizations (id, name, slug, created_by)
      VALUES (org_id, u.name || '''s organization', org_id, u.id)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO workspaces (id, organization_id, name, slug, created_by)
      VALUES (ws_id, org_id, 'Default workspace', ws_id, u.id)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (org_id, u.id, 'owner')
      ON CONFLICT DO NOTHING;
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (ws_id, u.id, 'owner')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END
$$;

-- Link any project still missing a workspace to the creator's first workspace.
UPDATE projects p
SET workspace_id = (
      SELECT wm.workspace_id FROM workspace_members wm
      WHERE wm.user_id = p.created_by LIMIT 1
    ),
    organization_id = (
      SELECT w.organization_id FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = p.created_by LIMIT 1
    )
WHERE p.workspace_id IS NULL;
