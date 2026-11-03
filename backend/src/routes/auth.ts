import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { authMiddleware, requireUser } from "../auth.js";
import { ApiError, asyncHandler } from "../lib/http.js";
import { refreshCookieOptions, signOAuthState, verifyOAuthState } from "../security/tokens.js";
import {
  currentUser,
  demoLogin,
  forgotPassword,
  listSessions,
  login,
  loginWithOAuth,
  register,
  requestMeta,
  resetPassword,
  revokeRefreshToken,
  revokeSession,
  rotateRefreshToken,
  updateProfile,
} from "../services/authService.js";

export const authRouter = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(200),
  fullName: z.string().min(2).max(120),
  organizationName: z.string().min(2).max(160).optional(),
});
const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
const DemoLoginSchema = z.object({ email: z.string().email() });
const ForgotSchema = z.object({ email: z.string().email() });
const ResetSchema = z.object({ token: z.string().min(10), password: z.string().min(10).max(200) });
const ProfileSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  title: z.string().max(120).optional(),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  timezone: z.string().max(80).optional(),
});

function refreshFromRequest(req: { body?: unknown; cookies?: Record<string, string> }): string | null {
  const body = req.body as { refreshToken?: unknown } | undefined;
  if (typeof body?.refreshToken === "string" && body.refreshToken) return body.refreshToken;
  const cookie = req.cookies?.[config.auth.cookieName];
  return typeof cookie === "string" && cookie ? cookie : null;
}

function setRefreshCookie(res: import("express").Response, token: string): void {
  res.cookie(
    config.auth.cookieName,
    token,
    refreshCookieOptions(config.auth.refreshTokenDays * 24 * 60 * 60),
  );
}

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const input = RegisterSchema.parse(req.body);
    const result = await register(input, requestMeta(req));
    setRefreshCookie(res, result.refreshToken);
    res.status(201).json(result);
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = LoginSchema.parse(req.body);
    const result = await login(input, requestMeta(req));
    setRefreshCookie(res, result.refreshToken);
    res.json(result);
  }),
);

authRouter.post(
  "/demo",
  asyncHandler(async (req, res) => {
    const input = DemoLoginSchema.parse(req.body);
    const result = await demoLogin(input.email, requestMeta(req));
    setRefreshCookie(res, result.refreshToken);
    res.json(result);
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = refreshFromRequest(req);
    if (!token) throw new ApiError(401, "NO_REFRESH_TOKEN", "No refresh token was supplied.");
    const result = await rotateRefreshToken(token, requestMeta(req));
    setRefreshCookie(res, result.refreshToken);
    res.json(result);
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = refreshFromRequest(req);
    if (token) await revokeRefreshToken(token, req.user?.id ?? null);
    res.clearCookie(config.auth.cookieName, { path: "/" });
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json(await currentUser(user.id));
  }),
);

authRouter.patch(
  "/profile",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = ProfileSchema.parse(req.body);
    await updateProfile(user.id, input);
    res.json(await currentUser(user.id));
  }),
);

authRouter.get(
  "/sessions",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const token = refreshFromRequest(req);
    res.json({ sessions: await listSessions(user.id, token ?? undefined) });
  }),
);

authRouter.delete(
  "/sessions/:id",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    await revokeSession(user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/password/forgot",
  asyncHandler(async (req, res) => {
    const input = ForgotSchema.parse(req.body);
    const result = await forgotPassword(input.email, requestMeta(req));
    res.json({
      ok: true,
      message: "If an account exists, a reset link has been issued.",
      devToken: result.devToken,
    });
  }),
);

authRouter.post(
  "/password/reset",
  asyncHandler(async (req, res) => {
    const input = ResetSchema.parse(req.body);
    await resetPassword(input.token, input.password, requestMeta(req));
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/oauth/status",
  asyncHandler(async (_req, res) => {
    res.json({
      meta: {
        configured: Boolean(config.metaOAuth.appId && config.metaOAuth.appSecret),
        label: "Continue with Meta",
        redirectUri: config.metaOAuth.redirectUri,
      },
    });
  }),
);

authRouter.get(
  "/oauth/meta/start",
  asyncHandler(async (req, res) => {
    if (!config.metaOAuth.appId || !config.metaOAuth.appSecret) {
      throw new ApiError(
        503,
        "META_OAUTH_NOT_CONFIGURED",
        "Meta OAuth is not configured. Set META_APP_ID and META_APP_SECRET on the server.",
      );
    }
    const requested = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";
    const returnTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
    const state = await signOAuthState(returnTo);
    const url = new URL(
      `https://www.facebook.com/${config.metaOAuth.graphVersion}/dialog/oauth`,
    );
    url.searchParams.set("client_id", config.metaOAuth.appId);
    url.searchParams.set("redirect_uri", config.metaOAuth.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "email,public_profile");
    res.redirect(url.toString());
  }),
);

authRouter.get(
  "/oauth/meta/callback",
  asyncHandler(async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const error = typeof req.query.error_description === "string"
      ? req.query.error_description
      : typeof req.query.error === "string"
        ? req.query.error
        : "";
    const verified = await verifyOAuthState(state);
    if (!verified) {
      res.redirect(`${config.webOrigin}/login?oauth_error=${encodeURIComponent("Invalid OAuth state.")}`);
      return;
    }
    if (error || !code) {
      res.redirect(`${config.webOrigin}/login?oauth_error=${encodeURIComponent(error || "Meta sign-in was cancelled.")}`);
      return;
    }
    if (!config.metaOAuth.appId || !config.metaOAuth.appSecret) {
      res.redirect(`${config.webOrigin}/login?oauth_error=${encodeURIComponent("Meta OAuth is not configured.")}`);
      return;
    }

    try {
      const tokenUrl = new URL(
        `https://graph.facebook.com/${config.metaOAuth.graphVersion}/oauth/access_token`,
      );
      tokenUrl.searchParams.set("client_id", config.metaOAuth.appId);
      tokenUrl.searchParams.set("client_secret", config.metaOAuth.appSecret);
      tokenUrl.searchParams.set("redirect_uri", config.metaOAuth.redirectUri);
      tokenUrl.searchParams.set("code", code);
      const tokenResponse = await fetch(tokenUrl, { signal: AbortSignal.timeout(15_000) });
      if (!tokenResponse.ok) {
        throw new Error(`Meta token exchange failed (HTTP ${tokenResponse.status}).`);
      }
      const tokenPayload = (await tokenResponse.json()) as { access_token?: string };
      if (!tokenPayload.access_token) throw new Error("Meta did not return an access token.");

      const profileUrl = new URL(
        `https://graph.facebook.com/${config.metaOAuth.graphVersion}/me`,
      );
      profileUrl.searchParams.set("fields", "id,name,email,picture");
      profileUrl.searchParams.set("access_token", tokenPayload.access_token);
      const profileResponse = await fetch(profileUrl, { signal: AbortSignal.timeout(15_000) });
      if (!profileResponse.ok) {
        throw new Error(`Meta profile request failed (HTTP ${profileResponse.status}).`);
      }
      const profile = (await profileResponse.json()) as {
        id?: string;
        name?: string;
        email?: string;
      };
      if (!profile.id) throw new Error("Meta profile did not include a user id.");

      const result = await loginWithOAuth(
        "meta",
        {
          providerUserId: profile.id,
          email: profile.email ?? null,
          name: profile.name ?? "Meta member",
        },
        requestMeta(req),
      );
      setRefreshCookie(res, result.refreshToken);
      const target = new URL("/auth/callback", config.webOrigin);
      target.searchParams.set("returnTo", verified.returnTo);
      res.redirect(target.toString());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Meta sign-in failed.";
      res.redirect(`${config.webOrigin}/login?oauth_error=${encodeURIComponent(message)}`);
    }
  }),
);
