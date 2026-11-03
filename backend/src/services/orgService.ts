import type { WorkspaceRole } from "@miraiwerk/schemas";
import { one, query, withTransaction, type Queryable } from "../db/pool.js";
import { ApiError, newId } from "../lib/http.js";
import { assertOrganizationAccess, assertWorkspaceAccess } from "../auth.js";

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  role: WorkspaceRole;
  workspaceCount: number;
  memberCount: number;
}

export interface WorkspaceDto {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string;
  role: WorkspaceRole;
  onboardingStage: number;
  memberCount: number;
  projectCount: number;
}

export function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "workspace";
}

async function uniqueSlug(client: Queryable, table: "organizations" | "workspaces", base: string): Promise<string> {
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await client.query(`SELECT 1 FROM ${table} WHERE slug = $1`, [candidate]);
    if (existing.rowCount === 0) return candidate;
    candidate = `${base}-${suffix++}`;
  }
}

export async function listOrganizations(userId: string): Promise<OrganizationDto[]> {
  const result = await query<{
    id: string;
    name: string;
    slug: string;
    description: string;
    role: WorkspaceRole;
    workspace_count: number;
    member_count: number;
  }>(
    `SELECT o.id, o.name, o.slug, o.description, om.role,
            (SELECT count(*)::int FROM workspaces w WHERE w.organization_id = o.id) AS workspace_count,
            (SELECT count(*)::int FROM organization_members m WHERE m.organization_id = o.id) AS member_count
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id AND om.user_id = $1
     ORDER BY o.name`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    role: row.role,
    workspaceCount: row.workspace_count,
    memberCount: row.member_count,
  }));
}

export async function listWorkspaces(
  userId: string,
  organizationId?: string,
): Promise<WorkspaceDto[]> {
  const result = await query<{
    id: string;
    organization_id: string;
    name: string;
    slug: string;
    description: string;
    role: WorkspaceRole;
    onboarding_stage: number;
    member_count: number;
    project_count: number;
  }>(
    `SELECT w.id, w.organization_id, w.name, w.slug, w.description,
            w.onboarding_stage,
            CASE
              WHEN COALESCE(wm.role, 'viewer') = 'owner' OR COALESCE(om.role, 'viewer') = 'owner' THEN 'owner'
              WHEN COALESCE(wm.role, 'viewer') = 'admin' OR COALESCE(om.role, 'viewer') = 'admin' THEN 'admin'
              WHEN COALESCE(wm.role, 'viewer') = 'manager' OR COALESCE(om.role, 'viewer') = 'manager' THEN 'manager'
              WHEN COALESCE(wm.role, 'viewer') = 'member' OR COALESCE(om.role, 'viewer') = 'member' THEN 'member'
              ELSE 'viewer'
            END AS role,
            (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
            (SELECT count(*)::int FROM projects p WHERE p.workspace_id = w.id) AS project_count
     FROM workspaces w
     LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
     LEFT JOIN organization_members om ON om.organization_id = w.organization_id AND om.user_id = $1
     WHERE (wm.user_id = $1 OR om.user_id = $1)
       AND ($2::text IS NULL OR w.organization_id = $2)
     ORDER BY project_count DESC, w.name`,
    [userId, organizationId ?? null],
  );
  return result.rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    role: row.role,
    onboardingStage: row.onboarding_stage,
    memberCount: row.member_count,
    projectCount: row.project_count,
  }));
}

export async function getWorkspace(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceDto> {
  const items = await listWorkspaces(userId);
  const found = items.find((workspace) => workspace.id === workspaceId);
  if (!found) throw new ApiError(404, "WORKSPACE_NOT_FOUND", "Workspace not found.");
  return found;
}

export async function createOrganization(
  userId: string,
  input: { name: string; workspaceName?: string; description?: string },
): Promise<{ organization: OrganizationDto; workspace: WorkspaceDto }> {
  const orgName = input.name.trim();
  if (orgName.length < 2) throw new ApiError(422, "INVALID_NAME", "Organization name is too short.");
  const workspaceName = (input.workspaceName ?? `${orgName} workspace`).trim();
  const orgId = newId("org");
  const wsId = newId("ws");

  await withTransaction(async (client) => {
    const orgSlug = await uniqueSlug(client, "organizations", slugify(orgName));
    await client.query(
      `INSERT INTO organizations (id, name, slug, description, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [orgId, orgName, orgSlug, input.description ?? "", userId],
    );
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1,$2,'owner')`,
      [orgId, userId],
    );
    const wsSlug = await uniqueSlug(client, "workspaces", slugify(workspaceName));
    await client.query(
      `INSERT INTO workspaces (id, organization_id, name, slug, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [wsId, orgId, workspaceName, wsSlug, userId],
    );
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1,$2,'owner')`,
      [wsId, userId],
    );
    await client.query(
      `INSERT INTO security_audit (id, user_id, action, outcome, metadata)
       VALUES ($1,$2,'organization.created','success',$3)`,
      [newId("sec"), userId, JSON.stringify({ organizationId: orgId, workspaceId: wsId })],
    );
  });

  const organizations = await listOrganizations(userId);
  const workspaces = await listWorkspaces(userId);
  const organization = organizations.find((item) => item.id === orgId);
  const workspace = workspaces.find((item) => item.id === wsId);
  if (!organization || !workspace) {
    throw new ApiError(500, "ORGANIZATION_CREATE_FAILED", "Organization could not be loaded after creation.");
  }
  return { organization, workspace };
}

/** Idempotently gives a new account a personal organization and workspace. */
export async function ensurePersonalWorkspace(userId: string, name: string): Promise<void> {
  const existing = await one<{ workspace_id: string }>(
    `SELECT workspace_id FROM workspace_members WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  if (existing) return;
  await createOrganization(userId, {
    name: `${name.split(" ")[0] || "Personal"}'s organization`,
    workspaceName: "General",
  });
}

export async function createWorkspace(
  userId: string,
  organizationId: string,
  input: { name: string; description?: string },
): Promise<WorkspaceDto> {
  await assertOrganizationAccess(userId, organizationId, ["owner", "admin", "manager"]);
  const name = input.name.trim();
  if (name.length < 2) throw new ApiError(422, "INVALID_NAME", "Workspace name is too short.");
  const id = newId("ws");
  await withTransaction(async (client) => {
    const slug = await uniqueSlug(client, "workspaces", slugify(name));
    await client.query(
      `INSERT INTO workspaces (id, organization_id, name, slug, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, organizationId, name, slug, input.description ?? "", userId],
    );
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1,$2,'owner')`,
      [id, userId],
    );
  });
  return getWorkspace(userId, id);
}

export async function updateWorkspace(
  userId: string,
  workspaceId: string,
  input: {
    name?: string;
    description?: string;
    onboardingStage?: number;
    aiContext?: Record<string, unknown>;
  },
): Promise<WorkspaceDto> {
  await assertWorkspaceAccess(userId, workspaceId, ["owner", "admin", "manager"]);
  await query(
    `UPDATE workspaces
     SET name = COALESCE($2, name),
         description = COALESCE($3, description),
         onboarding_stage = COALESCE($4, onboarding_stage),
         ai_context_json = COALESCE($5, ai_context_json),
         updated_at = now()
     WHERE id = $1`,
    [
      workspaceId,
      input.name?.trim() || null,
      input.description ?? null,
      input.onboardingStage ?? null,
      input.aiContext ? JSON.stringify(input.aiContext) : null,
    ],
  );
  return getWorkspace(userId, workspaceId);
}

export async function listWorkspaceMembers(userId: string, workspaceId: string) {
  await assertWorkspaceAccess(userId, workspaceId);
  const result = await query<{
    user_id: string;
    name: string;
    email: string;
    title: string;
    avatar_color: string;
    role: WorkspaceRole;
    created_at: string;
  }>(
    `SELECT wm.user_id, u.name, u.email, u.title, u.avatar_color, wm.role, wm.created_at
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'member' THEN 3 ELSE 4 END, u.name`,
    [workspaceId],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    title: row.title,
    avatarColor: row.avatar_color,
    role: row.role,
    createdAt: row.created_at,
  }));
}

export async function addWorkspaceMember(
  actorId: string,
  workspaceId: string,
  input: { email?: string; userId?: string; role?: WorkspaceRole },
): Promise<void> {
  await assertWorkspaceAccess(actorId, workspaceId, ["owner", "admin", "manager"]);
  const role = input.role ?? "member";
  if (role === "owner") {
    throw new ApiError(403, "ROLE_NOT_ASSIGNABLE", "Only the existing owner can transfer ownership.");
  }

  let target = input.userId
    ? await one<{ id: string }>("SELECT id FROM users WHERE id = $1", [input.userId])
    : null;
  if (!target && input.email) {
    target = await one<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = lower($1)",
      [input.email],
    );
    if (!target) {
      const id = newId("usr");
      const name = input.email.split("@")[0] ?? "Invited member";
      await query(
        `INSERT INTO users (id, name, email, title, status)
         VALUES ($1,$2,$3,'','pending')`,
        [id, name, input.email.toLowerCase()],
      );
      target = { id };
    }
  }
  if (!target) throw new ApiError(422, "MEMBER_REQUIRED", "Provide a user id or email.");

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [workspaceId, target!.id, role],
    );
    await client.query(
      `INSERT INTO security_audit (id, user_id, action, outcome, metadata)
       VALUES ($1,$2,'workspace.member_added','success',$3)`,
      [
        newId("sec"),
        actorId,
        JSON.stringify({ workspaceId, memberId: target!.id, role }),
      ],
    );
  });
}

export async function updateWorkspaceMemberRole(
  actorId: string,
  workspaceId: string,
  memberId: string,
  role: WorkspaceRole,
): Promise<void> {
  const actorRole = await assertWorkspaceAccess(actorId, workspaceId, ["owner", "admin"]);
  if (memberId === actorId && role !== "owner" && actorRole === "owner") {
    const owners = await one<{ count: number }>(
      `SELECT count(*)::int AS count FROM workspace_members
       WHERE workspace_id = $1 AND role = 'owner'`,
      [workspaceId],
    );
    if ((owners?.count ?? 0) <= 1) {
      throw new ApiError(409, "LAST_OWNER", "The workspace must retain at least one owner.");
    }
  }
  if (role === "owner" && actorRole !== "owner") {
    throw new ApiError(403, "FORBIDDEN", "Only an owner can grant ownership.");
  }
  const result = await query(
    `UPDATE workspace_members SET role = $3
     WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, memberId, role],
  );
  if (result.rowCount === 0) throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found.");
}

export async function removeWorkspaceMember(
  actorId: string,
  workspaceId: string,
  memberId: string,
): Promise<void> {
  await assertWorkspaceAccess(actorId, workspaceId, ["owner", "admin"]);
  const member = await one<{ role: WorkspaceRole }>(
    `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, memberId],
  );
  if (!member) throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found.");
  if (member.role === "owner") {
    const owners = await one<{ count: number }>(
      `SELECT count(*)::int AS count FROM workspace_members
       WHERE workspace_id = $1 AND role = 'owner'`,
      [workspaceId],
    );
    if ((owners?.count ?? 0) <= 1) {
      throw new ApiError(409, "LAST_OWNER", "The workspace must retain at least one owner.");
    }
  }
  await query(
    `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, memberId],
  );
}

export async function listTeams(userId: string, workspaceId: string) {
  await assertWorkspaceAccess(userId, workspaceId);
  const teams = await query<{
    id: string;
    workspace_id: string;
    name: string;
    description: string;
    lead_id: string | null;
    lead_name: string | null;
    member_count: number;
  }>(
    `SELECT t.id, t.workspace_id, t.name, t.description, t.lead_id,
            u.name AS lead_name,
            (SELECT count(*)::int FROM team_members m WHERE m.team_id = t.id) AS member_count
     FROM teams t LEFT JOIN users u ON u.id = t.lead_id
     WHERE t.workspace_id = $1 ORDER BY t.name`,
    [workspaceId],
  );
  const members = await query<{
    team_id: string;
    user_id: string;
    name: string;
    avatar_color: string;
    role: string;
  }>(
    `SELECT tm.team_id, tm.user_id, u.name, u.avatar_color,
            COALESCE(wm.role, 'member') AS role
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     JOIN users u ON u.id = tm.user_id
     LEFT JOIN workspace_members wm
       ON wm.workspace_id = t.workspace_id AND wm.user_id = tm.user_id
     WHERE t.workspace_id = $1`,
    [workspaceId],
  );
  return teams.rows.map((team) => ({
    id: team.id,
    workspaceId: team.workspace_id,
    name: team.name,
    description: team.description,
    leadId: team.lead_id,
    leadName: team.lead_name,
    memberCount: team.member_count,
    members: members.rows
      .filter((member) => member.team_id === team.id)
      .map((member) => ({
        userId: member.user_id,
        name: member.name,
        avatarColor: member.avatar_color,
        role: member.role,
      })),
  }));
}

export async function createTeam(
  userId: string,
  workspaceId: string,
  input: { name: string; description?: string; leadId?: string | null },
) {
  await assertWorkspaceAccess(userId, workspaceId, ["owner", "admin", "manager"]);
  const name = input.name.trim();
  if (name.length < 2) throw new ApiError(422, "INVALID_NAME", "Team name is too short.");
  const id = newId("team");
  await query(
    `INSERT INTO teams (id, workspace_id, name, description, lead_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, workspaceId, name, input.description ?? "", input.leadId ?? null],
  );
  if (input.leadId) {
    await query(
      `INSERT INTO team_members (team_id, user_id) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [id, input.leadId],
    );
  }
  const teams = await listTeams(userId, workspaceId);
  return teams.find((team) => team.id === id)!;
}

export async function addTeamMember(
  userId: string,
  workspaceId: string,
  teamId: string,
  memberId: string,
): Promise<void> {
  await assertWorkspaceAccess(userId, workspaceId, ["owner", "admin", "manager"]);
  const team = await one<{ id: string }>(
    `SELECT id FROM teams WHERE id = $1 AND workspace_id = $2`,
    [teamId, workspaceId],
  );
  if (!team) throw new ApiError(404, "TEAM_NOT_FOUND", "Team not found.");
  await query(
    `INSERT INTO team_members (team_id, user_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING`,
    [teamId, memberId],
  );
}

export async function workload(userId: string, workspaceId: string) {
  await assertWorkspaceAccess(userId, workspaceId);
  const result = await query<{
    user_id: string;
    name: string;
    avatar_color: string;
    role: WorkspaceRole;
    open_tasks: number;
    estimate_days: number;
    in_progress: number;
    blocked: number;
  }>(
    `SELECT u.id AS user_id, u.name, u.avatar_color, wm.role,
            count(t.id) FILTER (WHERE t.status <> 'done')::int AS open_tasks,
            COALESCE(sum(t.estimate_days) FILTER (WHERE t.status <> 'done'), 0)::float AS estimate_days,
            count(t.id) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
            count(t.id) FILTER (WHERE t.status = 'blocked')::int AS blocked
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     LEFT JOIN tasks t ON t.assignee_id = u.id
       AND t.project_id IN (SELECT id FROM projects WHERE workspace_id = $2)
     WHERE wm.workspace_id = $1
     GROUP BY u.id, u.name, u.avatar_color, wm.role
     ORDER BY estimate_days DESC, u.name`,
    [workspaceId, workspaceId],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    avatarColor: row.avatar_color,
    role: row.role,
    openTasks: row.open_tasks,
    estimateDays: Number(row.estimate_days),
    inProgress: row.in_progress,
    blockedTasks: row.blocked,
  }));
}


export async function listOrganizationMembers(userId: string, organizationId: string) {
  await assertOrganizationAccess(userId, organizationId);
  const result = await query<{
    user_id: string;
    name: string;
    email: string;
    title: string;
    avatar_color: string;
    role: WorkspaceRole;
    created_at: string;
  }>(
    `SELECT om.user_id, u.name, u.email, u.title, u.avatar_color, om.role, om.created_at
     FROM organization_members om
     JOIN users u ON u.id = om.user_id
     WHERE om.organization_id = $1
     ORDER BY CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'member' THEN 3 ELSE 4 END, u.name`,
    [organizationId],
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    title: row.title,
    avatarColor: row.avatar_color,
    role: row.role,
    createdAt: row.created_at,
  }));
}

export async function addOrganizationMember(
  actorId: string,
  organizationId: string,
  input: { email?: string; userId?: string; role?: WorkspaceRole },
): Promise<void> {
  await assertOrganizationAccess(actorId, organizationId, ["owner", "admin"]);
  const role = input.role ?? "member";
  if (role === "owner") throw new ApiError(403, "ROLE_NOT_ASSIGNABLE", "Ownership transfer is not supported here.");
  let target = input.userId
    ? await one<{ id: string }>("SELECT id FROM users WHERE id = $1", [input.userId])
    : null;
  if (!target && input.email) {
    target = await one<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [input.email]);
    if (!target) {
      const id = newId("usr");
      const name = input.email.split("@")[0] ?? "Invited member";
      await query(
        `INSERT INTO users (id, name, email, title, status) VALUES ($1,$2,$3,'','pending')`,
        [id, name, input.email.toLowerCase()],
      );
      target = { id };
    }
  }
  if (!target) throw new ApiError(422, "MEMBER_REQUIRED", "Provide a user id or email.");
  await query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1,$2,$3)
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [organizationId, target.id, role],
  );
}

export async function updateOrganizationMemberRole(
  actorId: string,
  organizationId: string,
  memberId: string,
  role: WorkspaceRole,
): Promise<void> {
  const actorRole = await assertOrganizationAccess(actorId, organizationId, ["owner", "admin"]);
  if (role === "owner" && actorRole !== "owner") {
    throw new ApiError(403, "FORBIDDEN", "Only an owner can grant ownership.");
  }
  const result = await query(
    `UPDATE organization_members SET role = $3
     WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, memberId, role],
  );
  if (result.rowCount === 0) throw new ApiError(404, "MEMBER_NOT_FOUND", "Member not found.");
}

export async function workspaceAudit(userId: string, workspaceId: string) {
  await assertWorkspaceAccess(userId, workspaceId, ["owner", "admin", "manager"]);
  const result = await query<{
    id: string;
    action: string;
    outcome: string;
    user_name: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>(
    `SELECT sa.id, sa.action, sa.outcome, u.name AS user_name, sa.metadata, sa.created_at
     FROM security_audit sa
     LEFT JOIN users u ON u.id = sa.user_id
     WHERE sa.metadata->>'workspaceId' = $1
     ORDER BY sa.created_at DESC LIMIT 100`,
    [workspaceId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    outcome: row.outcome,
    actorName: row.user_name,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}
