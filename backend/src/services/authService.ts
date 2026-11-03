import type { AuthResponse, Organization, Workspace, WorkspaceRole } from "@miraiwerk/schemas";
import type { Request } from "express";
import { config } from "../config.js";
import { one, query, withTransaction } from "../db/pool.js";
import { ApiError, newId } from "../lib/http.js";
import { hashPassword, passwordProblem, verifyPassword } from "../security/password.js";
import { createOpaqueToken, hashToken, signAccessToken } from "../security/tokens.js";
import { ensurePersonalWorkspace, listOrganizations, listWorkspaces } from "./orgService.js";

interface RequestMeta {
  userAgent: string;
  ip: string | null;
}

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  title: string;
  avatar_color: string;
  avatar_url: string | null;
  status: string;
  is_platform_admin: boolean;
  password_hash?: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  return {
    userAgent: (req.header("user-agent") ?? "").slice(0, 400),
    ip: req.ip ?? null,
  };
}

function userDto(user: StoredUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    title: user.title,
    avatarColor: user.avatar_color,
    avatarUrl: user.avatar_url,
    status: (user.status as "active") ?? "active",
    isPlatformAdmin: Boolean(user.is_platform_admin),
  };
}

async function findUserByEmail(email: string): Promise<StoredUser | null> {
  return one<StoredUser>(
    `SELECT id, name, email, title, avatar_color, avatar_url, status,
            is_platform_admin, password_hash
     FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
}

async function findUserById(id: string): Promise<StoredUser | null> {
  return one<StoredUser>(
    `SELECT id, name, email, title, avatar_color, avatar_url, status,
            is_platform_admin, password_hash
     FROM users WHERE id = $1`,
    [id],
  );
}

async function audit(
  userId: string | null,
  action: string,
  outcome: "success" | "failure",
  meta: RequestMeta,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await query(
      `INSERT INTO security_audit (id, user_id, action, outcome, ip_address, user_agent, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        newId("sec"),
        userId,
        action,
        outcome,
        meta.ip,
        meta.userAgent,
        JSON.stringify(metadata),
      ],
    );
  } catch (error) {
    console.error("security audit write failed", error);
  }
}

async function createSession(userId: string, meta: RequestMeta): Promise<string> {
  const { raw, hash } = createOpaqueToken();
  const expiresAt = new Date(
    Date.now() + config.auth.refreshTokenDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const familyId = newId("fam");
  await query(
    `INSERT INTO sessions
      (id, user_id, family_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [newId("ses"), userId, familyId, hash, meta.userAgent, meta.ip, expiresAt],
  );
  return raw;
}

async function authResponse(user: StoredUser, meta: RequestMeta): Promise<AuthResponse> {
  const { token, expiresIn } = await signAccessToken({
    id: user.id,
    email: user.email,
    name: user.name,
  });
  const refreshToken = await createSession(user.id, meta);
  const [organizations, workspaces] = await Promise.all([
    listOrganizations(user.id),
    listWorkspaces(user.id),
  ]);
  return {
    user: userDto(user),
    accessToken: token,
    refreshToken,
    expiresIn,
    organizations: organizations as Organization[],
    workspaces: workspaces as Workspace[],
  };
}

export async function register(
  input: { email: string; password: string; fullName: string; organizationName?: string },
  meta: RequestMeta,
): Promise<AuthResponse> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!email.includes("@")) throw new ApiError(422, "INVALID_EMAIL", "Enter a valid email address.");
  if (fullName.length < 2) throw new ApiError(422, "INVALID_NAME", "Enter your full name.");
  const problem = passwordProblem(input.password);
  if (problem) throw new ApiError(422, "WEAK_PASSWORD", problem);

  const existing = await findUserByEmail(email);
  if (existing?.password_hash) {
    throw new ApiError(409, "EMAIL_IN_USE", "An account with this email already exists.");
  }

  if (existing) {
    // Completing a pending invitation: set credentials and activate.
    await query(
      `UPDATE users
       SET name = $2, password_hash = $3, status = 'active', updated_at = now()
       WHERE id = $1`,
      [existing.id, fullName, await hashPassword(input.password)],
    );
    await ensurePersonalWorkspace(existing.id, fullName);
    await audit(existing.id, "auth.register", "success", meta, { completedInvitation: true });
    const user = await findUserById(existing.id);
    return authResponse(user!, meta);
  }

  const userId = newId("usr");
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO users (id, name, email, title, password_hash, status)
       VALUES ($1,$2,$3,'',$4,'active')`,
      [userId, fullName, email, await hashPassword(input.password)],
    );
  });
  await ensurePersonalWorkspace(userId, fullName);
  await audit(userId, "auth.register", "success", meta);
  const user = await findUserById(userId);
  return authResponse(user!, meta);
}

export async function login(
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<AuthResponse> {
  const user = await findUserByEmail(input.email.trim());
  const valid = user ? await verifyPassword(input.password, user.password_hash ?? null) : false;
  if (!user || !valid) {
    await audit(user?.id ?? null, "auth.login", "failure", meta, { email: input.email.slice(0, 120) });
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  if (user.status !== "active") {
    await audit(user.id, "auth.login", "failure", meta, { reason: "inactive" });
    throw new ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.");
  }
  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  await audit(user.id, "auth.login", "success", meta);
  return authResponse(user, meta);
}

/** Development/demo convenience only; never enabled implicitly in production. */
export async function demoLogin(email: string, meta: RequestMeta): Promise<AuthResponse> {
  if (!config.auth.allowDemo) {
    throw new ApiError(404, "NOT_FOUND", "Demo sign-in is disabled.");
  }
  const user = await findUserByEmail(email);
  if (!user) throw new ApiError(404, "DEMO_USER_NOT_FOUND", "Demo identity not found.");
  if (user.status !== "active") throw new ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.");
  await audit(user.id, "auth.demo_login", "success", meta);
  return authResponse(user, meta);
}

export async function rotateRefreshToken(
  rawToken: string,
  meta: RequestMeta,
): Promise<AuthResponse> {
  const hash = hashToken(rawToken);
  const session = await one<{
    id: string;
    user_id: string;
    family_id: string;
    expires_at: string;
    revoked_at: string | null;
  }>(`SELECT id, user_id, family_id, expires_at, revoked_at FROM sessions WHERE token_hash = $1`, [hash]);

  if (!session) {
    throw new ApiError(401, "INVALID_REFRESH", "Your session is no longer valid. Sign in again.");
  }
  if (session.revoked_at) {
    // Reuse of a rotated token: revoke the whole family.
    await query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'reuse_detected'
       WHERE family_id = $1 AND revoked_at IS NULL`,
      [session.family_id],
    );
    await audit(session.user_id, "auth.refresh_reuse", "failure", meta, {
      familyId: session.family_id,
    });
    throw new ApiError(401, "SESSION_REVOKED", "This session was revoked. Sign in again.");
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new ApiError(401, "SESSION_EXPIRED", "Your session expired. Sign in again.");
  }

  const user = await findUserById(session.user_id);
  if (!user || user.status !== "active") {
    throw new ApiError(401, "ACCOUNT_INACTIVE", "This account is not active.");
  }

  const { raw, hash: newHash } = createOpaqueToken();
  const newIdValue = newId("ses");
  const expiresAt = new Date(
    Date.now() + config.auth.refreshTokenDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO sessions
        (id, user_id, family_id, token_hash, user_agent, ip_address, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newIdValue, user.id, session.family_id, newHash, meta.userAgent, meta.ip, expiresAt],
    );
    await client.query(
      `UPDATE sessions
       SET rotated_to = $2, revoked_at = now(), revoked_reason = 'rotated', last_used_at = now()
       WHERE id = $1`,
      [session.id, newIdValue],
    );
  });

  const response = await authResponse(user, meta);
  // Replace the just-created refresh token with the rotated one so the caller
  // receives exactly one usable token.
  await query(`DELETE FROM sessions WHERE user_id = $1 AND token_hash = $2`, [
    user.id,
    hashToken(response.refreshToken),
  ]);
  return { ...response, refreshToken: raw };
}

export async function revokeRefreshToken(rawToken: string, userId: string | null): Promise<void> {
  if (!rawToken) return;
  const hash = hashToken(rawToken);
  const session = await one<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM sessions WHERE token_hash = $1`,
    [hash],
  );
  if (!session) return;
  if (userId && session.user_id !== userId) return;
  await query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout'
     WHERE id = $1 AND revoked_at IS NULL`,
    [session.id],
  );
}

export async function currentUser(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Unknown user.");
  const [organizations, workspaces] = await Promise.all([
    listOrganizations(userId),
    listWorkspaces(userId),
  ]);
  return { user: userDto(user), organizations, workspaces };
}

export async function listSessions(userId: string, currentToken?: string) {
  const currentHash = currentToken ? hashToken(currentToken) : null;
  const result = await query<{
    id: string;
    token_hash: string;
    user_agent: string;
    ip_address: string | null;
    created_at: string;
    last_used_at: string;
    expires_at: string;
  }>(
    `SELECT id, token_hash, user_agent, ip_address, created_at, last_used_at, expires_at
     FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY last_used_at DESC`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    current: currentHash !== null && row.token_hash === currentHash,
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const result = await query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'user_revoked'
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [sessionId, userId],
  );
  if (result.rowCount === 0) throw new ApiError(404, "SESSION_NOT_FOUND", "Session not found.");
}

export async function forgotPassword(
  email: string,
  meta: RequestMeta,
): Promise<{ devToken: string | null }> {
  const user = await findUserByEmail(email.trim());
  if (!user) {
    // Generic response: never disclose whether an account exists.
    return { devToken: null };
  }
  const { raw, hash } = createOpaqueToken();
  await query(
    `INSERT INTO one_time_tokens (id, user_id, purpose, token_hash, expires_at)
     VALUES ($1,$2,'password_reset',$3, now() + interval '30 minutes')`,
    [newId("ott"), user.id, hash],
  );
  await audit(user.id, "auth.password_forgot", "success", meta);
  const devToken = config.nodeEnv !== "production" ? raw : null;
  if (devToken) {
    console.log(`[dev] password reset token for ${user.email}: ${devToken}`);
  }
  return { devToken };
}

export async function resetPassword(
  token: string,
  password: string,
  meta: RequestMeta,
): Promise<void> {
  const problem = passwordProblem(password);
  if (problem) throw new ApiError(422, "WEAK_PASSWORD", problem);
  const row = await one<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM one_time_tokens
     WHERE token_hash = $1 AND purpose = 'password_reset'
       AND consumed_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  );
  if (!row) throw new ApiError(400, "INVALID_RESET_TOKEN", "This reset link is invalid or expired.");
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
      [row.user_id, await hashPassword(password)],
    );
    await client.query(`UPDATE one_time_tokens SET consumed_at = now() WHERE id = $1`, [row.id]);
    await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.user_id],
    );
  });
  await audit(row.user_id, "auth.password_reset", "success", meta);
}

export async function loginWithOAuth(
  provider: "meta" | "google" | "microsoft",
  profile: { providerUserId: string; email: string | null; name: string },
  meta: RequestMeta,
): Promise<AuthResponse> {
  const linked = await one<{ user_id: string }>(
    `SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2`,
    [provider, profile.providerUserId],
  );

  let userId = linked?.user_id ?? null;
  if (!userId && profile.email) {
    const byEmail = await findUserByEmail(profile.email);
    if (byEmail) userId = byEmail.id;
  }

  if (!userId) {
    userId = newId("usr");
    const email = profile.email ?? `${provider}_${profile.providerUserId}@users.miraiwerk.local`;
    await query(
      `INSERT INTO users (id, name, email, title, status)
       VALUES ($1,$2,$3,'','active')`,
      [userId, profile.name || `${provider} user`, email.toLowerCase()],
    );
    await ensurePersonalWorkspace(userId, profile.name || "Member");
  }

  await query(
    `INSERT INTO oauth_accounts
      (id, user_id, provider, provider_user_id, email_at_provider, last_login_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (provider, provider_user_id)
     DO UPDATE SET last_login_at = now(), email_at_provider = EXCLUDED.email_at_provider`,
    [newId("oa"), userId, provider, profile.providerUserId, profile.email],
  );

  const user = await findUserById(userId);
  if (!user) throw new ApiError(500, "OAUTH_USER_FAILED", "Could not load the OAuth account.");
  if (user.status !== "active") throw new ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.");
  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  await audit(user.id, `auth.oauth.${provider}`, "success", meta);
  return authResponse(user, meta);
}

export async function setAvatarColor(userId: string, color: string): Promise<void> {
  await query(`UPDATE users SET avatar_color = $2, updated_at = now() WHERE id = $1`, [
    userId,
    color,
  ]);
}

export async function updateProfile(
  userId: string,
  input: { name?: string; title?: string; avatarColor?: string; timezone?: string },
): Promise<void> {
  await query(
    `UPDATE users
     SET name = COALESCE($2, name),
         title = COALESCE($3, title),
         avatar_color = COALESCE($4, avatar_color),
         timezone = COALESCE($5, timezone),
         updated_at = now()
     WHERE id = $1`,
    [
      userId,
      input.name?.trim() || null,
      input.title?.trim() ?? null,
      input.avatarColor ?? null,
      input.timezone ?? null,
    ],
  );
}

export function workspaceRoleLabel(role: WorkspaceRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
