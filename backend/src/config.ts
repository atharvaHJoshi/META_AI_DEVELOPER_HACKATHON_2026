import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import {
  DETERMINISTIC_MODEL,
  getGeminiConfig,
  getMetaConfig,
} from "@miraiwerk/aiml";

function loadEnvFile(...paths: Array<string>) {
  for (const path of paths) {
    loadEnv({ path });
  }
}

loadEnvFile(
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../.env"),
  resolve(process.cwd(), "../../.env"),
);

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

const meta = getMetaConfig();
const gemini = getGeminiConfig();
const fallbackEnabled = boolFromEnv(process.env.AI_FALLBACK_ON_ERROR, true);
const requestedProvider = (process.env.AI_PROVIDER ?? "auto").toLowerCase();

function chooseProvider(): "gemini" | "meta" | "deterministic-demo" {
  if (requestedProvider === "gemini") return gemini.apiKey ? "gemini" : "deterministic-demo";
  if (requestedProvider === "meta") return meta.apiKey ? "meta" : "deterministic-demo";
  if (requestedProvider === "deterministic") return "deterministic-demo";
  if (gemini.apiKey) return "gemini";
  if (meta.apiKey) return "meta";
  return "deterministic-demo";
}

const provider = chooseProvider();
const model =
  provider === "gemini"
    ? gemini.model
    : provider === "meta"
      ? meta.model
      : DETERMINISTIC_MODEL;

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT) || 4000,
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://miraiwerk:miraiwerk_dev_pw@localhost:55434/miraiwerk",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  meta,
  gemini,
  aiFallbackOnError: fallbackEnabled,
  aiRequestedProvider: requestedProvider,
  demoUserEmail: "maya.chen@miraiwerk.demo",
  auth: {
    jwtSecret:
      process.env.JWT_SECRET ??
      "miraiwerk-dev-only-secret-change-me-before-production",
    accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 900,
    refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS) || 30,
    allowDemo: boolFromEnv(process.env.AUTH_ALLOW_DEMO, true),
    cookieName: "mw_refresh",
    cookieSecure: boolFromEnv(process.env.COOKIE_SECURE, false),
  },
  metaOAuth: {
    appId: process.env.META_APP_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
    redirectUri:
      process.env.META_OAUTH_REDIRECT_URI ??
      "http://localhost:4000/api/auth/oauth/meta/callback",
    graphVersion: process.env.META_GRAPH_VERSION ?? "v21.0",
  },
};

export const hasMetaKey = Boolean(meta.apiKey);
export const hasGeminiKey = Boolean(gemini.apiKey);

export const aiMode = {
  provider,
  model,
  usesGemini: provider === "gemini",
  usesMeta: provider === "meta",
  geminiConfigured: Boolean(gemini.apiKey),
  metaConfigured: Boolean(meta.apiKey),
  fallbackEnabled,
  label:
    provider === "gemini"
      ? `Google Gemini · ${gemini.model}`
      : provider === "meta"
        ? `Meta Model API · ${meta.model}`
        : "Deterministic rules · no AI key configured",
};
