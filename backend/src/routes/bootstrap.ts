import { Router } from "express";
import { requireUser } from "../auth.js";
import { asyncHandler } from "../lib/http.js";
import { getBootstrap } from "../services/projectService.js";

export const bootstrapRouter = Router();

bootstrapRouter.get(
  "/bootstrap",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const workspaceId = req.header("x-workspace-id")?.trim() || null;
    res.json(await getBootstrap(user.id, workspaceId));
  }),
);

