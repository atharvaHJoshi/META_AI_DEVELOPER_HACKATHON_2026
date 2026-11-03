import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { asyncHandler } from "../lib/http.js";
import {
  createDocument,
  createMeeting,
  createThread,
  convertActionItemsToTasks,
  deleteDocument,
  getThread,
  listDocuments,
  listMeetings,
  listThreads,
  replyToThread,
  setThreadSolved,
  updateDocument,
  updateMeeting,
} from "../services/collabService.js";
import { summarizeMeeting } from "../services/assistantService.js";

export const collabRouter = Router();

const DocType = z.enum(["markdown", "diagram"]);

collabRouter.get(
  "/workspaces/:workspaceId/documents",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
    res.json({
      documents: await listDocuments(user.id, String(req.params.workspaceId), projectId),
    });
  }),
);

collabRouter.post(
  "/workspaces/:workspaceId/documents",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        title: z.string().min(2).max(200),
        content: z.string().max(200_000).optional(),
        docType: DocType.optional(),
        projectId: z.string().nullable().optional(),
      })
      .parse(req.body);
    res.status(201).json(await createDocument(user.id, String(req.params.workspaceId), input));
  }),
);

collabRouter.patch(
  "/documents/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        title: z.string().min(2).max(200).optional(),
        content: z.string().max(200_000).optional(),
        status: z.string().max(40).optional(),
        docType: DocType.optional(),
      })
      .parse(req.body);
    res.json(await updateDocument(user.id, String(req.params.id), input));
  }),
);

collabRouter.delete(
  "/documents/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    await deleteDocument(user.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

collabRouter.get(
  "/workspaces/:workspaceId/meetings",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
    res.json({ meetings: await listMeetings(user.id, String(req.params.workspaceId), projectId) });
  }),
);

collabRouter.post(
  "/workspaces/:workspaceId/meetings",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        title: z.string().min(2).max(200),
        agenda: z.string().max(10_000).optional(),
        projectId: z.string().nullable().optional(),
        scheduledAt: z.string().datetime().nullable().optional(),
        durationMinutes: z.number().int().min(5).max(480).optional(),
      })
      .parse(req.body);
    res.status(201).json(await createMeeting(user.id, String(req.params.workspaceId), input));
  }),
);

collabRouter.patch(
  "/meetings/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        title: z.string().min(2).max(200).optional(),
        agenda: z.string().max(10_000).optional(),
        notes: z.string().max(50_000).optional(),
        scheduledAt: z.string().datetime().nullable().optional(),
        durationMinutes: z.number().int().min(5).max(480).optional(),
        status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).optional(),
        summary: z.string().max(20_000).optional(),
        actionItems: z
          .array(
            z.object({
              title: z.string().min(3).max(200),
              owner: z.string().max(120).default(""),
              dueDate: z.string().nullable().default(null),
              taskId: z.string().nullable().default(null),
            }),
          )
          .max(50)
          .optional(),
      })
      .parse(req.body);
    res.json(await updateMeeting(user.id, String(req.params.id), input));
  }),
);

collabRouter.post(
  "/meetings/:id/summarize",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const result = await summarizeMeeting(user.id, String(req.params.id));
    res.json(result);
  }),
);

collabRouter.post(
  "/meetings/:id/actions",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(req.body);
    const tasks = await convertActionItemsToTasks(user.id, String(req.params.id), projectId);
    res.status(201).json({ tasks });
  }),
);

collabRouter.get(
  "/workspaces/:workspaceId/threads",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
    res.json({ threads: await listThreads(user.id, String(req.params.workspaceId), projectId) });
  }),
);

collabRouter.post(
  "/workspaces/:workspaceId/threads",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        title: z.string().min(3).max(200),
        body: z.string().min(3).max(20_000),
        category: z.string().max(60).optional(),
        projectId: z.string().nullable().optional(),
      })
      .parse(req.body);
    res.status(201).json(await createThread(user.id, String(req.params.workspaceId), input));
  }),
);

collabRouter.get(
  "/threads/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json(await getThread(user.id, String(req.params.id)));
  }),
);

collabRouter.post(
  "/threads/:id/replies",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { body } = z.object({ body: z.string().min(1).max(20_000) }).parse(req.body);
    res.status(201).json(await replyToThread(user.id, String(req.params.id), body));
  }),
);

collabRouter.patch(
  "/threads/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { solved } = z.object({ solved: z.boolean() }).parse(req.body);
    res.json(await setThreadSolved(user.id, String(req.params.id), solved));
  }),
);
