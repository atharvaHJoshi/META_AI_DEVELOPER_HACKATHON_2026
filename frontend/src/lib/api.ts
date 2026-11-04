import type {
  AppBootstrap,
  AuthResponse,
  AuthSession,
  AuthUser,
  BoardTask,
  ClarifyDecisionInput,
  CreateProjectInput,
  CreateTicketInput,
  DecisionOption,
  DecisionOutcome,
  DecisionProposal,
  Document,
  ForumThread,
  GeneratePlanInput,
  GeneratedPlan,
  Meeting,
  MeetingActionItem,
  NotificationFeed,
  NotificationPreference,
  NotificationPreferenceList,
  Organization,
  ProjectHistory,
  ProjectPlan,
  ProjectSummary,
  ScenarioResult,
  Team,
  TicketDetail,
  TicketListItem,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from "@miraiwerk/schemas";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";
const TOKEN_KEY = "miraiwerk.access_token";
const WORKSPACE_KEY = "miraiwerk.workspace_id";

let accessToken: string | null = window.localStorage.getItem(TOKEN_KEY);
let activeWorkspaceId: string | null = window.localStorage.getItem(WORKSPACE_KEY);
let refreshPromise: Promise<AuthResponse | null> | null = null;

export const AUTH_EVENT = "miraiwerk:unauthenticated";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setActiveWorkspaceId(id: string | null): void {
  activeWorkspaceId = id;
  if (id) window.localStorage.setItem(WORKSPACE_KEY, id);
  else window.localStorage.removeItem(WORKSPACE_KEY);
}

export function getActiveWorkspaceId(): string | null {
  return activeWorkspaceId;
}

interface RequestOptions {
  skipAuth?: boolean;
  retryOnUnauthorized?: boolean;
}

async function parsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function refreshSession(): Promise<AuthResponse | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!response.ok) return null;
        const payload = (await parsePayload(response)) as AuthResponse;
        setAccessToken(payload.accessToken);
        return payload;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!options.skipAuth && accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (activeWorkspaceId) headers.set("x-workspace-id", activeWorkspaceId);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch (error) {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Cannot reach the MIRAIWERK API. Confirm the backend is running and the /api proxy is available.",
      error,
    );
  }

  if (response.status === 401 && !options.skipAuth && options.retryOnUnauthorized !== false) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, init, { ...options, retryOnUnauthorized: false });
    }
    setAccessToken(null);
    window.dispatchEvent(new CustomEvent(AUTH_EVENT));
  }

  const payload = await parsePayload(response);
  if (!response.ok) {
    const body = payload as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "REQUEST_FAILED",
      body?.error?.message ?? `Request failed with HTTP ${response.status}.`,
      body?.error?.details,
    );
  }
  return payload as T;
}

function post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) }, options);
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

function remove<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "DELETE",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function queryString(params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export interface WorkspaceWorkload {
  userId: string;
  name: string;
  avatarColor: string;
  role: WorkspaceRole;
  openTasks: number;
  estimateDays: number;
  blockedTasks: number;
}

export interface WorkspaceAuditEvent {
  id: string;
  action: string;
  outcome: string;
  actorName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RoadmapData {
  milestones: Array<{
    id: string;
    projectId: string;
    title: string;
    description: string;
    targetDate: string | null;
    releaseGate: boolean;
    status: string;
    position: number;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    milestoneId: string | null;
    plannedStart: string | null;
    plannedFinish: string | null;
    estimateDays: number;
    priority: string;
    assigneeName: string | null;
    dependencyIds: string[];
  }>;
}

export interface DecisionQueueItem {
  id: string;
  projectId: string;
  projectName: string;
  ticketId: string;
  ticketTitle: string;
  status: string;
  recommendation: DecisionOption;
  priority: string;
  createdAt: string;
}

export interface AiUsageRow {
  workflow: string;
  provider: string;
  model: string;
  calls: number;
  degraded: number;
  input_tokens: number | null;
  output_tokens: number | null;
  last_call: string;
}

export interface MeResponse {
  user: AuthUser;
  organizations: Organization[];
  workspaces: Workspace[];
}

export interface AssistResponse {
  text: string;
  provider: "gemini" | "deterministic-demo";
  model: string;
  degraded: boolean;
  notice: string | null;
  latencyMs: number;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      post<AuthResponse>("/auth/login", { email, password }, { skipAuth: true }),
    register: (input: {
      email: string;
      password: string;
      fullName: string;
      organizationName?: string;
    }) => post<AuthResponse>("/auth/register", input, { skipAuth: true }),
    demo: (email: string) => post<AuthResponse>("/auth/demo", { email }, { skipAuth: true }),
    refresh: () => refreshSession(),
    logout: () => post<{ ok: boolean }>("/auth/logout", {}),
    me: () =>
      request<MeResponse>("/auth/me", {}, { retryOnUnauthorized: false }),
    profile: (input: {
      name?: string;
      title?: string;
      avatarColor?: string;
      timezone?: string;
    }) => patch<MeResponse>("/auth/profile", input),
    sessions: () => request<{ sessions: AuthSession[] }>("/auth/sessions"),
    revokeSession: (id: string) => remove<{ ok: boolean }>(`/auth/sessions/${id}`),
    oauthStatus: () =>
      request<{ meta: { configured: boolean; label: string; redirectUri: string } }>(
        "/auth/oauth/status",
        {},
        { skipAuth: true },
      ),
    forgotPassword: (email: string) =>
      post<{ ok: boolean; message: string; devToken: string | null }>(
        "/auth/password/forgot",
        { email },
        { skipAuth: true },
      ),
    resetPassword: (token: string, password: string) =>
      post<{ ok: boolean }>(
        "/auth/password/reset",
        { token, password },
        { skipAuth: true },
      ),
  },

  bootstrap: () => request<AppBootstrap>("/bootstrap"),

  projects: {
    list: () => request<{ projects: ProjectSummary[] }>("/projects"),
    getPlan: (projectId: string) => request<ProjectPlan>(`/projects/${projectId}/plan`),
    getHistory: (projectId: string) =>
      request<ProjectHistory>(`/projects/${projectId}/history`),
    create: (input: CreateProjectInput) => post<ProjectPlan>("/projects", input),
    generatePlan: (input: GeneratePlanInput) =>
      post<GeneratedPlan>("/projects/generate-plan", input),
  },

  tasks: {
    list: (projectId: string) =>
      request<{ tasks: BoardTask[] }>(`/projects/${projectId}/tasks`),
    create: (projectId: string, input: Record<string, unknown>) =>
      post<BoardTask>(`/projects/${projectId}/tasks`, input),
    update: (taskId: string, input: Record<string, unknown>) =>
      patch<BoardTask>(`/tasks/${taskId}`, input),
    addDependency: (projectId: string, predecessorId: string, successorId: string) =>
      post<{ ok: boolean }>(`/projects/${projectId}/dependencies`, {
        predecessorId,
        successorId,
      }),
    removeDependency: (projectId: string, predecessorId: string, successorId: string) =>
      remove<{ ok: boolean }>(`/projects/${projectId}/dependencies`, {
        predecessorId,
        successorId,
      }),
    roadmap: (projectId: string) =>
      request<RoadmapData>(`/projects/${projectId}/roadmap`),
    createMilestone: (projectId: string, input: Record<string, unknown>) =>
      post(`/projects/${projectId}/milestones`, input),
    updateMilestone: (milestoneId: string, input: Record<string, unknown>) =>
      patch(`/milestones/${milestoneId}`, input),
  },

  tickets: {
    list: (projectId: string) =>
      request<{ tickets: TicketListItem[] }>(`/projects/${projectId}/tickets`),
    create: (input: CreateTicketInput) => post<TicketDetail>("/tickets", input),
    get: (ticketId: string) => request<TicketDetail>(`/tickets/${ticketId}`),
    analyze: (ticketId: string) => post<TicketDetail>(`/tickets/${ticketId}/analyze`, {}),
  },

  decisions: {
    list: (status: "pending" | "all" = "pending") =>
      request<{ decisions: DecisionQueueItem[] }>(
        `/decisions${queryString({ status })}`,
      ),
    get: (decisionId: string) =>
      request<DecisionProposal>(`/decisions/${decisionId}`),
    simulate: (decisionId: string, option: DecisionOption, baselineVersion?: number) =>
      post<ScenarioResult>(`/decisions/${decisionId}/simulate`, {
        option,
        baselineVersion,
      }),
    approve: (decisionId: string, option: DecisionOption, reason: string) =>
      post<DecisionOutcome>(`/decisions/${decisionId}/approve`, { option, reason }),
    reject: (decisionId: string, reason: string) =>
      post<DecisionOutcome>(`/decisions/${decisionId}/reject`, { reason }),
    clarify: (decisionId: string, input: ClarifyDecisionInput) =>
      post<DecisionOutcome>(`/decisions/${decisionId}/clarify`, input),
  },

  organizations: {
    list: () => request<{ organizations: Organization[] }>("/organizations"),
    create: (input: { name: string; workspaceName?: string; description?: string }) =>
      post<{ organization: Organization; workspace: Workspace }>("/organizations", input),
    members: (organizationId: string) =>
      request<{ members: WorkspaceMember[] }>(`/organizations/${organizationId}/members`),
    addMember: (
      organizationId: string,
      input: { email?: string; userId?: string; role: WorkspaceRole },
    ) => post<{ ok: boolean }>(`/organizations/${organizationId}/members`, input),
    updateMember: (organizationId: string, userId: string, role: WorkspaceRole) =>
      patch<{ ok: boolean }>(`/organizations/${organizationId}/members/${userId}`, { role }),
  },

  workspaces: {
    list: () => request<{ workspaces: Workspace[] }>("/workspaces"),
    create: (input: { organizationId: string; name: string; description?: string }) =>
      post<Workspace>("/workspaces", input),
    get: (workspaceId: string) => request<Workspace>(`/workspaces/${workspaceId}`),
    update: (workspaceId: string, input: Record<string, unknown>) =>
      patch<Workspace>(`/workspaces/${workspaceId}`, input),
    members: (workspaceId: string) =>
      request<{ members: WorkspaceMember[] }>(`/workspaces/${workspaceId}/members`),
    addMember: (
      workspaceId: string,
      input: { email?: string; userId?: string; role: WorkspaceRole },
    ) => post<{ ok: boolean }>(`/workspaces/${workspaceId}/members`, input),
    updateMember: (workspaceId: string, userId: string, role: WorkspaceRole) =>
      patch<{ ok: boolean }>(`/workspaces/${workspaceId}/members/${userId}`, { role }),
    removeMember: (workspaceId: string, userId: string) =>
      remove<{ ok: boolean }>(`/workspaces/${workspaceId}/members/${userId}`),
    teams: (workspaceId: string) =>
      request<{ teams: Team[] }>(`/workspaces/${workspaceId}/teams`),
    createTeam: (
      workspaceId: string,
      input: { name: string; description?: string; leadId?: string | null },
    ) => post<Team>(`/workspaces/${workspaceId}/teams`, input),
    addTeamMember: (workspaceId: string, teamId: string, userId: string) =>
      post<{ ok: boolean }>(`/workspaces/${workspaceId}/teams/${teamId}/members`, {
        userId,
      }),
    workload: (workspaceId: string) =>
      request<{ workload: WorkspaceWorkload[] }>(`/workspaces/${workspaceId}/workload`),
    audit: (workspaceId: string) =>
      request<{ events: WorkspaceAuditEvent[] }>(`/workspaces/${workspaceId}/audit`),
    onboarding: (workspaceId: string, input: Record<string, unknown>) =>
      post<Workspace>(`/workspaces/${workspaceId}/onboarding`, input),
  },

  docs: {
    list: (workspaceId: string, projectId?: string | null) =>
      request<{ documents: Document[] }>(
        `/workspaces/${workspaceId}/documents${queryString({ projectId })}`,
      ),
    create: (workspaceId: string, input: Record<string, unknown>) =>
      post<Document>(`/workspaces/${workspaceId}/documents`, input),
    update: (documentId: string, input: Record<string, unknown>) =>
      patch<Document>(`/documents/${documentId}`, input),
    remove: (documentId: string) => remove<{ ok: boolean }>(`/documents/${documentId}`),
    draft: (input: {
      workspaceId: string;
      projectId?: string | null;
      title: string;
      outline: string;
      docType?: "markdown" | "diagram";
    }) => post<AssistResponse>("/ai/documents/draft", input),
  },

  meetings: {
    list: (workspaceId: string, projectId?: string | null) =>
      request<{ meetings: Meeting[] }>(
        `/workspaces/${workspaceId}/meetings${queryString({ projectId })}`,
      ),
    create: (workspaceId: string, input: Record<string, unknown>) =>
      post<Meeting>(`/workspaces/${workspaceId}/meetings`, input),
    update: (meetingId: string, input: Record<string, unknown>) =>
      patch<Meeting>(`/meetings/${meetingId}`, input),
    summarize: (meetingId: string) =>
      post<{ summary: string; actionItems: MeetingActionItem[]; assistant: AssistResponse }>(
        `/meetings/${meetingId}/summarize`,
        {},
      ),
    convertActions: (meetingId: string, projectId: string) =>
      post<{ tasks: BoardTask[] }>(`/meetings/${meetingId}/actions`, { projectId }),
  },

  threads: {
    list: (workspaceId: string, projectId?: string | null) =>
      request<{ threads: ForumThread[] }>(
        `/workspaces/${workspaceId}/threads${queryString({ projectId })}`,
      ),
    get: (threadId: string) => request<ForumThread>(`/threads/${threadId}`),
    create: (workspaceId: string, input: Record<string, unknown>) =>
      post<ForumThread>(`/workspaces/${workspaceId}/threads`, input),
    reply: (threadId: string, body: string) =>
      post<ForumThread>(`/threads/${threadId}/replies`, { body }),
    solve: (threadId: string, solved: boolean) =>
      patch<ForumThread>(`/threads/${threadId}`, { solved }),
  },

  ai: {
    status: () =>
      request<{
        provider: string;
        model: string;
        usesGemini: boolean;
        usesMeta: boolean;
        fallbackEnabled: boolean;
        label: string;
        geminiConfigured: boolean;
        metaConfigured: boolean;
      }>("/ai/status"),
    usage: (workspaceId: string) =>
      request<{ usage: AiUsageRow[] }>(`/ai/usage${queryString({ workspaceId })}`),
  },

  notifications: {
    list: (input: { status?: "all" | "unread"; limit?: number; offset?: number } = {}) =>
      request<NotificationFeed>(
        `/notifications${queryString({
          status: input.status ?? "all",
          limit: String(input.limit ?? 20),
          offset: String(input.offset ?? 0),
        })}`,
      ),
    unreadCount: () =>
      request<{ unreadCount: number }>("/notifications/unread-count"),
    markRead: (notificationId: string) =>
      post<{ ok: boolean }>(`/notifications/${notificationId}/read`, {}),
    markAllRead: () => post<{ ok: boolean; updated: number }>("/notifications/read-all", {}),
    preferences: () =>
      request<NotificationPreferenceList>("/notification-preferences"),
    updatePreferences: (preferences: Array<Pick<NotificationPreference, "category" | "inApp" | "email">>) =>
      patch<NotificationPreferenceList>("/notification-preferences", { preferences }),
  },

  health: () =>
    request<{ status: string; time: string; ai: string; aiLabel: string }>(
      "/health",
      {},
      { skipAuth: true },
    ),
};
