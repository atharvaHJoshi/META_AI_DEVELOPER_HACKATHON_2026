/**
 * AIML runtime configuration.
 *
 * Values are read lazily so that callers can load `.env` before the first model
 * call. The package never reads or persists secrets on behalf of the browser.
 */

export const DETERMINISTIC_MODEL = "miraiwerk-rules-v1";

export interface MetaConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  useTools: boolean;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

export function getMetaConfig(): MetaConfig {
  return {
    apiKey: process.env.MODEL_API_KEY ?? process.env.META_API_KEY ?? "",
    baseUrl: process.env.META_BASE_URL ?? "https://api.meta.ai/v1",
    model: process.env.META_MODEL ?? "muse-spark-1.3",
    timeoutMs: numberFromEnv(process.env.META_TIMEOUT_MS, 45_000),
    maxRetries: numberFromEnv(process.env.META_MAX_RETRIES, 2),
    useTools: boolFromEnv(process.env.META_TOOLS, true),
  };
}

export function hasMetaKey(): boolean {
  return Boolean(getMetaConfig().apiKey);
}


export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
}

/**
 * Google Gemini free-tier configuration. The key is server-only and is never
 * returned to the browser or persisted with a proposal.
 */
export function getGeminiConfig(): GeminiConfig {
  return {
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    baseUrl:
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta",
    timeoutMs: numberFromEnv(process.env.GEMINI_TIMEOUT_MS, 45_000),
    maxRetries: numberFromEnv(process.env.GEMINI_MAX_RETRIES, 1),
  };
}

export function hasGeminiKey(): boolean {
  return Boolean(getGeminiConfig().apiKey);
}
