import { Router } from "express";
import {
  CreateProjectInputSchema,
  GeneratePlanInputSchema,
} from "@miraiwerk/schemas";
import { requireUser } from "../auth.js";
import { asyncHandler } from "../lib/http.js";
import { generatePlan } from "../services/planService.js";
import {
  createProject,
  getProjectHistory,
  getProjectPlan,
  listProjects,
  listTickets,
} from "../services/projectService.js";

export const projectsRouter = Router();

projectsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const workspaceId = req.header("x-workspace-id")?.trim() || null;
    res.json({ projects: await listProjects(user.id, workspaceId) });
  }),
);

projectsRouter.post(
  "/generate-plan",
  asyncHandler(async (req, res) => {
    const input = GeneratePlanInputSchema.parse(req.body);
    const plan = await generatePlan(input, null);
    res.json(plan);
  }),
);

projectsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = CreateProjectInputSchema.parse(req.body);
    const workspaceId = req.header("x-workspace-id")?.trim() || null;
    const plan = await createProject(user.id, input, input.generation ?? null, { workspaceId });
    res.status(201).json(plan);
  }),
);

projectsRouter.get(
  "/:id/plan",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json(await getProjectPlan(user.id, req.params.id as string));
  }),
);

projectsRouter.get(
  "/:id/tickets",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json({ tickets: await listTickets(user.id, req.params.id as string) });
  }),
);

projectsRouter.get(
  "/:id/history",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json(await getProjectHistory(user.id, req.params.id as string));
  }),
);
