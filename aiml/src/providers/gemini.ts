import { PlanDraftSchema, TicketAnalysisSchema, type PlanDraft, type TicketAnalysis } from "@miraiwerk/schemas";
import { getGeminiConfig } from "../config.js";
import { planDraftGeminiSchema, ticketAnalysisGeminiSchema } from "../schemaJson.js";
import { ANALYSIS_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT, analysisContextPrompt, parseJson, planUserPrompt } from "./meta.js";
import type {
  AnalysisContext,
  PlanGenerationResult,
  PlanInput,
  TicketAnalysisResult,
  Usage,
} from "../types.js";

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string; status?: string; code?: number };
}

export class GeminiError extends Error {
  retryable: boolean;
  status: number | null;
  constructor(message: string, options?: { retryable?: boolean; status?: number }) {
    super(message);
    this.name = "GeminiError";
    this.retryable = options?.retryable ?? false;
    this.status = options?.status ?? null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOf(response: GeminiResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((part) => part.text ?? "").join("").trim();
  if (!text) {
    throw new GeminiError("Gemini returned no text content.", { retryable: false });
  }
  return text;
}

function usageOf(response: GeminiResponse): Usage {
  return {
    inputTokens: response.usageMetadata?.promptTokenCount ?? null,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
  };
}

function hasResponseSchema(body: Record<string, unknown>): boolean {
  const generationConfig = body.generationConfig as Record<string, unknown> | undefined;
  return Boolean(generationConfig && "responseSchema" in generationConfig);
}

function withoutResponseSchema(body: Record<string, unknown>): Record<string, unknown> {
  const { generationConfig, ...rest } = body as Record<string, Record<string, unknown>>;
  if (!generationConfig) return body;
  const { responseSchema: _dropped, ...config } = generationConfig;
  return { ...rest, generationConfig: config };
}

async function callGemini(body: Record<string, unknown>): Promise<{ response: GeminiResponse; latencyMs: number }> {
  const cfg = getGeminiConfig();
  if (!cfg.apiKey) {
    throw new GeminiError("GEMINI_API_KEY is not configured.", { retryable: false });
  }
  const started = Date.now();
  const attempts = Math.max(1, Math.min(cfg.maxRetries + 1, 3));
  let lastError: Error | null = null;
  let useSchema = hasResponseSchema(body);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(
        `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(useSchema ? body : withoutResponseSchema(body)),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        let message = `Gemini returned HTTP ${response.status}.`;
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string } };
          if (parsed.error?.message) message = parsed.error.message;
        } catch {
          if (text) message = `${message} ${text.slice(0, 300)}`;
        }
        const retryable = response.status === 429 || response.status >= 500;
        // The structured-output schema can be rejected by the API on complex
        // object graphs. Retry once without it: the JSON contract is still
        // enforced by Zod and by the labelled fallback.
        if (response.status === 400 && useSchema) {
          useSchema = false;
          lastError = new GeminiError(message, { retryable: false, status: 400 });
          attempt -= 1;
          continue;
        }
        lastError = new GeminiError(message, { retryable, status: response.status });
        if (!retryable || attempt === attempts - 1) throw lastError;
        // Respect Retry-After when present, but cap the wait so a demo request
        // never hangs. Quota exhaustion surfaces as a labelled fallback.
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 4000)
          : 600 * 2 ** attempt;
        await sleep(waitMs);
        continue;
      }

      const parsed = (await response.json()) as GeminiResponse;
      return { response: parsed, latencyMs: Date.now() - started };
    } catch (error) {
      if (error instanceof GeminiError) {
        if (!error.retryable || attempt === attempts - 1) throw error;
        lastError = error;
      } else {
        const message = error instanceof Error ? error.message : "Unknown Gemini error";
        lastError = new GeminiError(`Gemini request failed: ${message}`, { retryable: true });
        if (attempt === attempts - 1) throw lastError;
      }
      await sleep(600 * 2 ** attempt);
    }
  }

  throw lastError ?? new GeminiError("Gemini request failed.");
}

interface Validated<T> {
  value: T;
  latencyMs: number;
  usage: Usage;
}

/**
 * Structured output helper.
 *
 * Free-tier models frequently return well-formed JSON that is missing required
 * keys (for example `classification.priority`). Instead of surfacing that as a
 * hard failure, each mismatch is fed back to the model and the request is
 * retried. When every attempt still fails validation a `GeminiError` is thrown
 * so callers can activate their labelled deterministic fallback — no unlabelled
 * output and no bare 502.
 */
async function generateValidated<T>(options: {
  label: string;
  buildBody: (feedback: string | null) => Record<string, unknown>;
  validate: (text: string) => T;
}): Promise<Validated<T>> {
  const started = Date.now();
  const attempts = Math.max(1, Math.min(getGeminiConfig().maxRetries + 1, 3));
  let feedback: string | null = null;
  let issue = "unknown validation issue";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { response, latencyMs } = await callGemini(options.buildBody(feedback));
    try {
      const text = textOf(response);
      return {
        value: options.validate(text),
        latencyMs: Math.max(latencyMs, Date.now() - started),
        usage: usageOf(response),
      };
    } catch (error) {
      issue = (error instanceof Error ? error.message : "Unknown validation error").slice(0, 800);
      feedback =
        `Your previous ${options.label} response failed contract validation:\n${issue}\n` +
        "Return the complete JSON object again, with every required field present and no wrapper object.";
      if (attempt < attempts - 1) await sleep(400 * 2 ** attempt);
    }
  }

  throw new GeminiError(
    `Gemini returned JSON that failed contract validation after ${attempts} attempt(s): ${issue}`,
    { retryable: true },
  );
}

export async function geminiGeneratePlan(
  input: PlanInput,
  feedback?: string,
): Promise<PlanGenerationResult> {
  const { value: draft, latencyMs, usage } = await generateValidated<PlanDraft>({
    label: "plan",
    buildBody: (retryFeedback) => ({
      systemInstruction: { parts: [{ text: PLAN_SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: planUserPrompt(
                input,
                [feedback, retryFeedback].filter(Boolean).join("\n\n") || undefined,
              ),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 12_000,
        responseMimeType: "application/json",
        responseSchema: planDraftGeminiSchema,
      },
    }),
    validate: (text) => PlanDraftSchema.parse(parseJson(text)) as PlanDraft,
  });

  return {
    draft,
    provider: "gemini",
    model: getGeminiConfig().model,
    degraded: false,
    notice: null,
    latencyMs,
    usage,
  };
}

export async function geminiAnalyzeTicket(
  context: AnalysisContext,
): Promise<TicketAnalysisResult> {
  const { value: analysis, latencyMs, usage } = await generateValidated<TicketAnalysis>({
    label: "ticket analysis",
    buildBody: (retryFeedback) => ({
      systemInstruction: { parts: [{ text: ANALYSIS_SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: retryFeedback
                ? `${analysisContextPrompt(context)}\n\n${retryFeedback}`
                : analysisContextPrompt(context),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8_000,
        responseMimeType: "application/json",
        responseSchema: ticketAnalysisGeminiSchema,
      },
    }),
    validate: (text) => TicketAnalysisSchema.parse(parseJson(text)) as TicketAnalysis,
  });

  return {
    analysis,
    provider: "gemini",
    model: getGeminiConfig().model,
    degraded: false,
    notice: null,
    latencyMs,
    usage,
    toolCalls: [],
  };
}

export interface AssistResult {
  text: string;
  provider: "gemini" | "deterministic-demo";
  model: string;
  degraded: boolean;
  notice: string | null;
  latencyMs: number;
  usage: Usage | null;
}

/**
 * Free-text assistance for documentation and meeting summaries. Callers must
 * validate or explicitly label the output before it can affect project state.
 */
export async function geminiAssist(input: {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<AssistResult> {
  const started = Date.now();
  const { response, latencyMs } = await callGemini({
    systemInstruction: { parts: [{ text: input.system }] },
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    generationConfig: {
      temperature: input.temperature ?? 0.3,
      maxOutputTokens: Math.min(input.maxTokens ?? 2_000, 8_000),
    },
  });
  return {
    text: textOf(response),
    provider: "gemini",
    model: getGeminiConfig().model,
    degraded: false,
    notice: null,
    latencyMs: Math.max(latencyMs, Date.now() - started),
    usage: usageOf(response),
  };
}
