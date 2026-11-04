import { z } from "zod";

/** Organization/workspace roles derive from Nirnaya's RBAC model. */
export const WorkspaceRoleSchema = z.enum([
  "owner",
  "admin",
  "manager",
  "member",
  "viewer",
]);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const AccountStatusSchema = z.enum(["pending", "active", "suspended"]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string().default(""),
  avatarColor: z.string().default("#5B6CFF"),
  avatarUrl: z.string().nullable().optional(),
  status: AccountStatusSchema.default("active"),
  isPlatformAdmin: z.boolean().default(false),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().default(""),
  role: WorkspaceRoleSchema.default("member"),
  workspaceCount: z.number().default(0),
  memberCount: z.number().default(0),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const WorkspaceSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().default(""),
  role: WorkspaceRoleSchema.default("member"),
  onboardingStage: z.number().default(1),
  memberCount: z.number().default(0),
  projectCount: z.number().default(0),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string().default(""),
  avatarColor: z.string().default("#5B6CFF"),
  role: WorkspaceRoleSchema,
  createdAt: z.string().optional(),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const AuthSessionSchema = z.object({
  id: z.string(),
  userAgent: z.string().default(""),
  ipAddress: z.string().nullable().default(null),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  expiresAt: z.string(),
  current: z.boolean().default(false),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const AuthResponseSchema = z.object({
  user: AuthUserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  organizations: z.array(OrganizationSchema),
  workspaces: z.array(WorkspaceSchema),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const TeamSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().default(""),
  leadId: z.string().nullable().default(null),
  leadName: z.string().nullable().default(null),
  memberCount: z.number().default(0),
  members: z
    .array(
      z.object({
        userId: z.string(),
        name: z.string(),
        avatarColor: z.string(),
        role: z.string(),
      }),
    )
    .default([]),
});
export type Team = z.infer<typeof TeamSchema>;

export const TaskDependencySchema = z.object({
  predecessorId: z.string(),
  successorId: z.string(),
  dependencyType: z.string().default("finishes_to_start"),
});
export type TaskDependency = z.infer<typeof TaskDependencySchema>;

export const BoardTaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().default(""),
  status: z.enum(["planned", "in_progress", "blocked", "done"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  estimateDays: z.number(),
  ownerRole: z.string().default("Engineering"),
  requirementId: z.string().nullable().default(null),
  milestoneId: z.string().nullable().default(null),
  milestoneTitle: z.string().nullable().default(null),
  assigneeId: z.string().nullable().default(null),
  assigneeName: z.string().nullable().default(null),
  assigneeColor: z.string().nullable().default(null),
  labels: z.array(z.string()).default([]),
  plannedStart: z.string().nullable().default(null),
  plannedFinish: z.string().nullable().default(null),
  sourceTicketId: z.string().nullable().default(null),
  dependencyIds: z.array(z.string()).default([]),
});
export type BoardTask = z.infer<typeof BoardTaskSchema>;

export const DocumentSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable().default(null),
  title: z.string(),
  docType: z.enum(["markdown", "diagram"]),
  content: z.string().default(""),
  status: z.string().default("draft"),
  createdBy: z.string().nullable().default(null),
  createdByName: z.string().nullable().default(null),
  updatedByName: z.string().nullable().default(null),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const MeetingActionItemSchema = z.object({
  title: z.string(),
  owner: z.string().default(""),
  dueDate: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
});
export type MeetingActionItem = z.infer<typeof MeetingActionItemSchema>;

export const MeetingSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable().default(null),
  title: z.string(),
  agenda: z.string().default(""),
  notes: z.string().default(""),
  scheduledAt: z.string().nullable().default(null),
  durationMinutes: z.number().default(30),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]),
  summary: z.string().default(""),
  actionItems: z.array(MeetingActionItemSchema).default([]),
  createdByName: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Meeting = z.infer<typeof MeetingSchema>;

export const ForumReplySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  body: z.string(),
  createdBy: z.string().nullable().default(null),
  createdByName: z.string().nullable().default(null),
  createdAt: z.string(),
});

export const ForumThreadSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable().default(null),
  title: z.string(),
  body: z.string(),
  category: z.string().default("general"),
  solved: z.boolean().default(false),
  createdByName: z.string().nullable().default(null),
  replyCount: z.number().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  replies: z.array(ForumReplySchema).optional(),
});
export type ForumThread = z.infer<typeof ForumThreadSchema>;

export const AiStatusSchema = z.object({
  provider: z.enum(["gemini", "meta", "deterministic-demo"]),
  model: z.string(),
  usesGemini: z.boolean(),
  usesMeta: z.boolean(),
  fallbackEnabled: z.boolean(),
  label: z.string(),
  geminiConfigured: z.boolean(),
  metaConfigured: z.boolean(),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

export const AppNotificationSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  type: z.string(),
  title: z.string(),
  message: z.string().default(""),
  entityType: z.string().default(""),
  entityId: z.string().default(""),
  link: z.string().default(""),
  isRead: z.boolean().default(false),
  createdAt: z.string(),
});
export type AppNotification = z.infer<typeof AppNotificationSchema>;

export const NotificationFeedSchema = z.object({
  notifications: z.array(AppNotificationSchema),
  unreadCount: z.number().default(0),
  hasMore: z.boolean().default(false),
});
export type NotificationFeed = z.infer<typeof NotificationFeedSchema>;

export const NotificationPreferenceSchema = z.object({
  category: z.string(),
  inApp: z.boolean().default(true),
  email: z.boolean().default(true),
  locked: z.boolean().default(false),
});
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;

export const NotificationPreferenceListSchema = z.object({
  preferences: z.array(NotificationPreferenceSchema),
});
export type NotificationPreferenceList = z.infer<typeof NotificationPreferenceListSchema>;
