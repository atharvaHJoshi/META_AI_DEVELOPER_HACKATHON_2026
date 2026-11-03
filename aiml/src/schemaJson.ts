import { zodToJsonSchema } from "zod-to-json-schema";
import { PlanDraftSchema, TicketAnalysisSchema } from "@miraiwerk/schemas";

function toJsonSchema(schema: Parameters<typeof zodToJsonSchema>[0], name: string) {
  const json = zodToJsonSchema(schema, {
    name,
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export const planDraftJsonSchema = toJsonSchema(PlanDraftSchema, "MiraiwerkPlan");
export const ticketAnalysisJsonSchema = toJsonSchema(
  TicketAnalysisSchema,
  "MiraiwerkTicketAnalysis",
);

type Json = Record<string, unknown>;

/**
 * Unwrap the zod-to-json-schema `$ref` envelope so the root is a plain object
 * schema. Gemini requires the `responseSchema` root to describe an object.
 */
function resolveRoot(schema: Json): Json {
  const ref = typeof schema.$ref === "string" ? schema.$ref : null;
  if (!ref) return schema;
  const definitions = schema.definitions as Json | undefined;
  const key = ref.split("/").pop() ?? "";
  const target = definitions?.[key];
  return target && typeof target === "object" ? (target as Json) : schema;
}

/**
 * Normalise a JSON Schema for the Gemini structured-output contract.
 *
 * Gemini only accepts a subset of JSON Schema:
 * - `default`, `additionalProperties` and `$schema` are rejected outright.
 * - Nullability is expressed with `nullable`, not a `{ type: "null" }` branch
 *   or a `type` array.
 * - Size constraints (`minItems`, `maxItems`, `minimum`, `maximum`,
 *   `minLength`, `maxLength`, `pattern`) are dropped: the API rejects them on
 *   sufficiently complex object graphs while Zod still enforces every one of
 *   them server-side after the response arrives.
 */
const GEMINI_REJECTED_KEYS = new Set([
  "default",
  "additionalProperties",
  "$schema",
  "$ref",
  "definitions",
  "examples",
  "deprecated",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
]);

function geminiSafe(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiSafe);
  if (!node || typeof node !== "object") return node;

  const source = node as Json;
  const out: Json = {};
  for (const [key, value] of Object.entries(source)) {
    if (GEMINI_REJECTED_KEYS.has(key)) {
      continue;
    }

    if (key === "type" && Array.isArray(value)) {
      const types = [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
      const hasNull = types.includes("null");
      const concrete = types.filter((entry) => entry !== "null");
      if (hasNull) out.nullable = true;
      if (concrete.length === 1) out.type = concrete[0];
      else if (concrete.length > 1) out.anyOf = concrete.map((entry) => ({ type: entry }));
      continue;
    }

    if (key === "anyOf" && Array.isArray(value)) {
      const branches = value.map(geminiSafe) as Json[];
      const nonNull = branches.filter((branch) => branch.type !== "null");
      if (branches.length === 2 && nonNull.length === 1) {
        out.nullable = true;
        Object.assign(out, nonNull[0]);
        continue;
      }
      out.anyOf = branches;
      continue;
    }

    out[key] = geminiSafe(value);
  }
  return out;
}

export const planDraftGeminiSchema = geminiSafe(resolveRoot(planDraftJsonSchema)) as Json;
export const ticketAnalysisGeminiSchema = geminiSafe(
  resolveRoot(ticketAnalysisJsonSchema),
) as Json;
