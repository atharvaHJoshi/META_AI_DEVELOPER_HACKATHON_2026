import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { asyncHandler } from "../lib/http.js";
import {
  addTaskDependency,
  createMilestone,
  createTask,
  listProjectTasks,
  projectRoadmap,
  removeTaskDependency,
  updateMilestone,
  updateTask,
} from "../services/taskService.js";

export const tasksRouter = Router();

const Status = z.enum(["planned", "in_progress", "blocked", "done"]);
const Priority = z.enum(["P0", "P1", "P2", "P3"]);

const CreateTaskSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional(),
  status: Status.optional(),
  priority: Priority.optional(),
  estimateDays: z.number().min(0.5).max(60).optional(),
  ownerRole: z.string().max(80).optional(),
  requirementId: z.string().nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  labels: z.array(z.string().max(40)).max(20).optional(),
  plannedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  plannedFinish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dependencyIds: z.array(z.string()).max(50).optional(),
  sourceTicketId: z.string().nullable().optional(),
});

const UpdateTaskSchema = CreateTaskSchema.omit({ dependencyIds: true, sourceTicketId: true }).partial();

tasksRouter.get(
  "/projects/:id/tasks",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json({ tasks: await listProjectTasks(user.id, String(req.params.id)) });
  }),
);

tasksRouter.post(
  "/projects/:id/tasks",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = CreateTaskSchema.parse(req.body);
    res.status(201).json(await createTask(user.id, String(req.params.id), input));
  }),
);

tasksRouter.patch(
  "/tasks/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = UpdateTaskSchema.parse(req.body);
    res.json(await updateTask(user.id, String(req.params.id), input));
  }),
);

tasksRouter.post(
  "/projects/:id/dependencies",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({ predecessorId: z.string().min(1), successorId: z.string().min(1) })
      .parse(req.body);
    await addTaskDependency(user.id, String(req.params.id), input.predecessorId, input.successorId);
    res.status(201).json({ ok: true });
  }),
);

tasksRouter.delete(
  "/projects/:id/dependencies",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({ predecessorId: z.string().min(1), successorId: z.string().min(1) })
      .parse(req.body);
    await removeTaskDependency(user.id, String(req.params.id), input.predecessorId, input.successorId);
    res.json({ ok: true });
  }),
);

tasksRouter.get(
  "/projects/:id/roadmap",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json(await projectRoadmap(user.id, String(req.params.id)));
  }),
);

tasksRouter.post(
  "/projects/:id/milestones",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        title: z.string().min(2).max(160),
        description: z.string().max(1000).optional(),
        targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        releaseGate: z.boolean().optional(),
      })
      .parse(req.body);
    res.status(201).json(await createMilestone(user.id, String(req.params.id), input));
  }),
);

tasksRouter.patch(
  "/milestones/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        title: z.string().min(2).max(160).optional(),
        description: z.string().max(1000).optional(),
        targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        releaseGate: z.boolean().optional(),
        status: z.string().max(40).optional(),
      })
      .parse(req.body);
    res.json(await updateMilestone(user.id, String(req.params.id), input));
  }),
);
