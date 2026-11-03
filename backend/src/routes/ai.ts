import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { asyncHandler } from "../lib/http.js";
import { query } from "../db/pool.js";
import { draftDocument, assistantStatus } from "../services/assistantService.js";
import { assertWorkspaceAccess } from "../auth.js";

export const aiRouter = Router();

aiRouter.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json(assistantStatus());
  }),
);

aiRouter.post(
  "/documents/draft",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        workspaceId: z.string().min(1),
        projectId: z.string().nullable().optional(),
        title: z.string().min(2).max(200),
        outline: z.string().min(3).max(20_000),
      })
      .parse(req.body);
    res.json(await draftDocument(user.id, input.workspaceId, input));
  }),
);

aiRouter.get(
  "/usage",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const workspaceId = String(req.query.workspaceId ?? "");
    if (!workspaceId) {
      res.json({ usage: [] });
      return;
    }
    await assertWorkspaceAccess(user.id, workspaceId);
    const result = await query<{
      workflow: string;
      provider: string;
      model: string;
      calls: number;
      degraded: number;
      input_tokens: number | null;
      output_tokens: number | null;
      last_call: string;
    }>(
      `SELECT workflow, provider, model, count(*)::int AS calls,
              count(*) FILTER (WHERE degraded)::int AS degraded,
              sum((usage_json->>'inputTokens')::int) AS input_tokens,
              sum((usage_json->>'outputTokens')::int) AS output_tokens,
              max(created_at) AS last_call
       FROM ai_calls WHERE workspace_id = $1
       GROUP BY workflow, provider, model
       ORDER BY calls DESC`,
      [workspaceId],
    );
    res.json({ usage: result.rows });
  }),
);
