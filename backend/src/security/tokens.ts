import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

const secret = new TextEncoder().encode(config.auth.jwtSecret);
const issuer = "miraiwerk-ai";

export interface AccessClaims {
  sub: string;
  email: string;
  name: string;
  purpose: "access";
}

export async function signAccessToken(user: {
  id: string;
  email: string;
  name: string;
}): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = config.auth.accessTokenTtlSeconds;
  const token = await new SignJWT({
    email: user.email,
    name: user.name,
    purpose: "access",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience("miraiwerk-web")
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret);
  return { token, expiresIn };
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer,
      audience: "miraiwerk-web",
    });
    if (payload.purpose !== "access" || typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      name: typeof payload.name === "string" ? payload.name : "",
      purpose: "access",
    };
  } catch {
    return null;
  }
}

export async function signOAuthState(returnTo: string): Promise<string> {
  return new SignJWT({ purpose: "oauth", returnTo })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience("miraiwerk-oauth")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

export async function verifyOAuthState(
  state: string,
): Promise<{ returnTo: string } | null> {
  try {
    const { payload } = await jwtVerify(state, secret, {
      issuer,
      audience: "miraiwerk-oauth",
    });
    if (payload.purpose !== "oauth") return null;
    return { returnTo: typeof payload.returnTo === "string" ? payload.returnTo : "/" };
  } catch {
    return null;
  }
}

export function createOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function refreshCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  };
}
