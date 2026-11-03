import type { NextFunction, Request, Response } from "express";
import type { ProjectRole, WorkspaceRole } from "@miraiwerk/schemas";
import { one } from "./db/pool.js";
import { ApiError } from "./lib/http.js";
import { config } from "./config.js";
import { verifyAccessToken } from "./security/tokens.js";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  title: string;
  avatar_color: string;
  status?: string;
  is_platform_admin?: boolean;
  avatar_url?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
      accessToken?: string;
    }
  }
}

const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  member: 1,
  pm: 2,
  owner: 3,
};

const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  manager: 2,
  admin: 3,
  owner: 4,
};

export async function getUserById(userId: string): Promise<UserRow | null> {
  return one<UserRow>(
    `SELECT id, name, email, title, avatar_color, status,
            is_platform_admin, avatar_url
     FROM users WHERE id = $1`,
    [userId],
  );
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  return one<UserRow>(
    `SELECT id, name, email, title, avatar_color, status,
            is_platform_admin, avatar_url
     FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
}

function bearerToken(req: Request): string | null {
  const header = req.header("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Resolves a real bearer identity first. The legacy x-user-id header remains
 * available only when AUTH_ALLOW_DEMO=true (development and the integration
 * test suite). There is deliberately no implicit anonymous demo fallback.
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearerToken(req);
    let userId: string | null = null;
    if (token) {
      const claims = await verifyAccessToken(token);
      if (!claims) throw new ApiError(401, "INVALID_TOKEN", "Your session has expired. Sign in again.");
      userId = claims.sub;
      req.accessToken = token;
    } else if (config.auth.allowDemo) {
      userId = req.header("x-user-id")?.trim() || null;
    }

    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    const user = await getUserById(userId);
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Unknown user identity.");
    if (user.status && user.status !== "active") {
      throw new ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.");
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireUser(req: Request): UserRow {
  if (!req.user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return req.user;
}

export async function organizationRole(
  userId: string,
  organizationId: string,
): Promise<WorkspaceRole | null> {
  const row = await one<{ role: WorkspaceRole }>(
    `SELECT role FROM organization_members WHERE user_id = $1 AND organization_id = $2`,
    [userId, organizationId],
  );
  return row?.role ?? null;
}

export async function workspaceRole(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const row = await one<{
    workspace_role: WorkspaceRole | null;
    org_role: WorkspaceRole | null;
  }>(
    `SELECT wm.role AS workspace_role, om.role AS org_role
     FROM workspaces w
     LEFT JOIN workspace_members wm
       ON wm.workspace_id = w.id AND wm.user_id = $1
     LEFT JOIN organization_members om
       ON om.organization_id = w.organization_id AND om.user_id = $1
     WHERE w.id = $2`,
    [userId, workspaceId],
  );
  if (!row) return null;
  const candidates = [row.workspace_role, row.org_role].filter(
    (role): role is WorkspaceRole => Boolean(role),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, role) =>
    WORKSPACE_ROLE_RANK[role] > WORKSPACE_ROLE_RANK[best] ? role : best,
  );
}

export async function assertOrganizationAccess(
  userId: string,
  organizationId: string,
  allowed: WorkspaceRole[] = ["owner", "admin", "manager", "member", "viewer"],
): Promise<WorkspaceRole> {
  const role = await organizationRole(userId, organizationId);
  if (!role) throw new ApiError(403, "FORBIDDEN", "You are not a member of this organization.");
  if (!allowed.includes(role)) {
    throw new ApiError(403, "FORBIDDEN", `This action requires organization roles: ${allowed.join(", ")}.`);
  }
  return role;
}

export async function assertWorkspaceAccess(
  userId: string,
  workspaceId: string,
  allowed: WorkspaceRole[] = ["owner", "admin", "manager", "member", "viewer"],
): Promise<WorkspaceRole> {
  const role = await workspaceRole(userId, workspaceId);
  if (!role) throw new ApiError(403, "FORBIDDEN", "You are not a member of this workspace.");
  if (!allowed.includes(role)) {
    throw new ApiError(403, "FORBIDDEN", `This action requires workspace roles: ${allowed.join(", ")}.`);
  }
  return role;
}

function workspaceRoleToProjectRole(role: WorkspaceRole): ProjectRole {
  if (role === "owner" || role === "admin") return "owner";
  if (role === "manager") return "pm";
  if (role === "member") return "member";
  return "viewer";
}

/**
 * Project authorization. An explicit project membership is the primary grant;
 * workspace and organization roles provide tenant-wide access. Both paths
 * require a real membership row, so a caller cannot reach a project by guessing
 * an id.
 */
export async function projectRole(
  userId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  const explicit = await one<{ role: ProjectRole }>(
    `SELECT role FROM project_members WHERE user_id = $1 AND project_id = $2`,
    [userId, projectId],
  );
  if (explicit) return explicit.role;

  const row = await one<{
    workspace_id: string | null;
    organization_id: string | null;
    workspace_role: WorkspaceRole | null;
    org_role: WorkspaceRole | null;
  }>(
    `SELECT p.workspace_id,
            COALESCE(p.organization_id, w.organization_id) AS organization_id,
            wm.role AS workspace_role,
            om.role AS org_role
     FROM projects p
     LEFT JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN workspace_members wm
       ON wm.workspace_id = p.workspace_id AND wm.user_id = $1
     LEFT JOIN organization_members om
       ON om.organization_id = COALESCE(p.organization_id, w.organization_id)
      AND om.user_id = $1
     WHERE p.id = $2`,
    [userId, projectId],
  );
  if (!row) return null;
  const candidates = [row.workspace_role, row.org_role].filter(
    (role): role is WorkspaceRole => Boolean(role),
  );
  if (candidates.length === 0) return null;
  const best = candidates.reduce((current, role) =>
    WORKSPACE_ROLE_RANK[role] > WORKSPACE_ROLE_RANK[current] ? role : current,
  );
  return workspaceRoleToProjectRole(best);
}

export async function assertProjectAccess(
  userId: string,
  projectId: string,
  allowed: ProjectRole[] = ["owner", "pm", "member", "viewer"],
): Promise<ProjectRole> {
  const role = await projectRole(userId, projectId);
  if (!role) {
    throw new ApiError(403, "FORBIDDEN", "You are not a member of this project.");
  }
  if (!allowed.includes(role)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      `This action requires one of these project roles: ${allowed.join(", ")}.`,
    );
  }
  return role;
}

export function highestProjectRole(roles: Array<ProjectRole | null>): ProjectRole {
  let best: ProjectRole = "viewer";
  for (const role of roles) {
    if (role && PROJECT_ROLE_RANK[role] > PROJECT_ROLE_RANK[best]) best = role;
  }
  return best;
}

export function requireWorkspaceId(req: Request): string {
  const fromHeader = req.header("x-workspace-id")?.trim();
  const fromQuery = typeof req.query.workspaceId === "string" ? req.query.workspaceId.trim() : "";
  const id = fromHeader || fromQuery;
  if (!id) {
    throw new ApiError(
      400,
      "WORKSPACE_REQUIRED",
      "Select a workspace (x-workspace-id) before using this operation.",
    );
  }
  return id;
}
