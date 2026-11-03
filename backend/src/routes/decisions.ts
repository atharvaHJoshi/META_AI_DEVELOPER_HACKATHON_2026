import { Router } from "express";
import {
  ApproveDecisionInputSchema,
  ClarifyDecisionInputSchema,
  RejectDecisionInputSchema,
  SimulationRequestSchema,
} from "@miraiwerk/schemas";
import { requireUser } from "../auth.js";
import { asyncHandler } from "../lib/http.js";
import {
  approveDecision,
  clarifyDecision,
  listDecisionQueue,
  rejectDecision,
} from "../services/decisionService.js";
import { simulateDecision } from "../services/simulationService.js";
import { getDecisionProposal } from "../services/ticketService.js";

export const decisionsRouter = Router();

decisionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const workspaceId = req.header("x-workspace-id")?.trim();
    if (!workspaceId) {
      res.status(400).json({
        error: { code: "WORKSPACE_REQUIRED", message: "Select a workspace first." },
      });
      return;
    }
    const status = req.query.status === "all" ? "all" : "pending";
    res.json({ decisions: await listDecisionQueue(user.id, workspaceId, status) });
  }),
);

decisionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json(await getDecisionProposal(user.id, req.params.id as string));
  }),
);

decisionsRouter.post(
  "/:id/simulate",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = SimulationRequestSchema.parse(req.body ?? {});
    res.json(
      await simulateDecision(user.id, req.params.id as string, input.option, input.baselineVersion),
    );
  }),
);

decisionsRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = ApproveDecisionInputSchema.parse(req.body);
    res.json(await approveDecision(user.id, req.params.id as string, input.option, input.reason));
  }),
);

decisionsRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = RejectDecisionInputSchema.parse(req.body);
    res.json(await rejectDecision(user.id, req.params.id as string, input.reason));
  }),
);

decisionsRouter.post(
  "/:id/clarify",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = ClarifyDecisionInputSchema.parse(req.body);
    res.json(await clarifyDecision(user.id, req.params.id as string, input));
  }),
);
