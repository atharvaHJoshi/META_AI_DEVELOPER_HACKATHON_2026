import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../auth.js";
import { asyncHandler } from "../lib/http.js";
import {
  addOrganizationMember,
  addTeamMember,
  addWorkspaceMember,
  createOrganization,
  createTeam,
  createWorkspace,
  getWorkspace,
  listOrganizationMembers,
  listOrganizations,
  listTeams,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
  updateOrganizationMemberRole,
  updateWorkspace,
  updateWorkspaceMemberRole,
  workspaceAudit,
  workload,
} from "../services/orgService.js";

export const organizationsRouter = Router();
export const workspacesRouter = Router();

const Role = z.enum(["owner", "admin", "manager", "member", "viewer"]);

const CreateOrganizationSchema = z.object({
  name: z.string().min(2).max(160),
  workspaceName: z.string().min(2).max(120).optional(),
  description: z.string().max(1000).optional(),
});
const MemberSchema = z.object({
  email: z.string().email().optional(),
  userId: z.string().min(1).optional(),
  role: Role.default("member"),
});
const WorkspaceSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(1000).optional(),
  onboardingStage: z.number().int().min(1).max(8).optional(),
  aiContext: z.record(z.unknown()).optional(),
});

organizationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json({ organizations: await listOrganizations(user.id) });
  }),
);

organizationsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = CreateOrganizationSchema.parse(req.body);
    res.status(201).json(await createOrganization(user.id, input));
  }),
);

organizationsRouter.get(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json({ members: await listOrganizationMembers(user.id, String(req.params.id)) });
  }),
);

organizationsRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = MemberSchema.parse(req.body);
    await addOrganizationMember(user.id, String(req.params.id), input);
    res.status(201).json({ ok: true });
  }),
);

organizationsRouter.patch(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { role } = z.object({ role: Role }).parse(req.body);
    await updateOrganizationMemberRole(
      user.id,
      String(req.params.id),
      String(req.params.userId),
      role,
    );
    res.json({ ok: true });
  }),
);

workspacesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const organizationId =
      typeof req.query.organizationId === "string" ? req.query.organizationId : undefined;
    res.json({ workspaces: await listWorkspaces(user.id, organizationId) });
  }),
);

workspacesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        organizationId: z.string().min(1),
        name: z.string().min(2).max(120),
        description: z.string().max(1000).optional(),
      })
      .parse(req.body);
    res.status(201).json(await createWorkspace(user.id, input.organizationId, input));
  }),
);

workspacesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json(await getWorkspace(user.id, String(req.params.id)));
  }),
);

workspacesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = WorkspaceSchema.parse(req.body);
    res.json(await updateWorkspace(user.id, String(req.params.id), input));
  }),
);

workspacesRouter.get(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json({ members: await listWorkspaceMembers(user.id, String(req.params.id)) });
  }),
);

workspacesRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = MemberSchema.parse(req.body);
    await addWorkspaceMember(user.id, String(req.params.id), input);
    res.status(201).json({ ok: true });
  }),
);

workspacesRouter.patch(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { role } = z.object({ role: Role }).parse(req.body);
    await updateWorkspaceMemberRole(
      user.id,
      String(req.params.id),
      String(req.params.userId),
      role,
    );
    res.json({ ok: true });
  }),
);

workspacesRouter.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    await removeWorkspaceMember(user.id, String(req.params.id), String(req.params.userId));
    res.json({ ok: true });
  }),
);

workspacesRouter.get(
  "/:id/teams",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json({ teams: await listTeams(user.id, String(req.params.id)) });
  }),
);

workspacesRouter.post(
  "/:id/teams",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        name: z.string().min(2).max(120),
        description: z.string().max(1000).optional(),
        leadId: z.string().min(1).nullable().optional(),
      })
      .parse(req.body);
    res.status(201).json(await createTeam(user.id, String(req.params.id), input));
  }),
);

workspacesRouter.post(
  "/:id/teams/:teamId/members",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.body);
    await addTeamMember(user.id, String(req.params.id), String(req.params.teamId), userId);
    res.status(201).json({ ok: true });
  }),
);

workspacesRouter.get(
  "/:id/workload",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json({ workload: await workload(user.id, String(req.params.id)) });
  }),
);

workspacesRouter.get(
  "/:id/audit",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json({ events: await workspaceAudit(user.id, String(req.params.id)) });
  }),
);

workspacesRouter.post(
  "/:id/onboarding",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = z
      .object({
        stage: z.number().int().min(1).max(8),
        aiContext: z.record(z.unknown()).optional(),
        name: z.string().min(2).max(120).optional(),
        description: z.string().max(1000).optional(),
      })
      .parse(req.body);
    res.json(
      await updateWorkspace(user.id, String(req.params.id), {
        onboardingStage: input.stage,
        aiContext: input.aiContext,
        name: input.name,
        description: input.description,
      }),
    );
  }),
);
