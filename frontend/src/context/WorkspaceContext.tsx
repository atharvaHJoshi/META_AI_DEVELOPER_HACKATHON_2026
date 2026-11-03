import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AppBootstrap,
  Organization,
  ProjectSummary,
  User,
  Workspace,
  WorkspaceRole,
} from "@miraiwerk/schemas";
import {
  api,
  ApiError,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from "../lib/api";
import { useAuth } from "./AuthContext";

interface WorkspaceContextValue {
  bootstrap: AppBootstrap | null;
  projects: ProjectSummary[];
  users: User[];
  organizations: Organization[];
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  activeOrganization: Organization | null;
  activeWorkspaceId: string | null;
  role: WorkspaceRole | null;
  aiMode: AppBootstrap["aiMode"] | null;
  ticketCounts: AppBootstrap["ticketCounts"];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  canManageWorkspace: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [activeId, setActiveId] = useState<string | null>(getActiveWorkspaceId());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (preferredId?: string | null) => {
      if (!user) {
        setBootstrap(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let data = await api.bootstrap();
        let target =
          data.workspaces.find((workspace) => workspace.id === (preferredId ?? activeId)) ??
          data.workspaces[0] ??
          null;

        if (!target) {
          setActiveWorkspaceId(null);
          setActiveId(null);
          setBootstrap(data);
          return;
        }

        if (data.activeWorkspaceId !== target.id) {
          setActiveWorkspaceId(target.id);
          setActiveId(target.id);
          data = await api.bootstrap();
          target = data.workspaces.find((workspace) => workspace.id === target!.id) ?? target;
        } else if (getActiveWorkspaceId() !== target.id) {
          setActiveWorkspaceId(target.id);
          setActiveId(target.id);
        }

        setBootstrap(data);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "The workspace could not be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [user, activeId],
  );

  useEffect(() => {
    if (user) void load();
    else {
      setBootstrap(null);
      setActiveId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const refresh = useCallback(async () => {
    await load(activeId);
  }, [load, activeId]);

  const refreshProjects = useCallback(async () => {
    const result = await api.projects.list();
    setBootstrap((current) => (current ? { ...current, projects: result.projects } : current));
  }, []);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      setActiveWorkspaceId(workspaceId);
      setActiveId(workspaceId);
      await load(workspaceId);
    },
    [load],
  );

  const workspaces = bootstrap?.workspaces ?? [];
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0] ?? null;
  const activeOrganization =
    bootstrap?.organizations.find((organization) => organization.id === activeWorkspace?.organizationId) ?? null;
  const role = activeWorkspace?.role ?? null;

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      bootstrap,
      projects: bootstrap?.projects ?? [],
      users: bootstrap?.users ?? [],
      organizations: bootstrap?.organizations ?? [],
      workspaces,
      activeWorkspace,
      activeOrganization,
      activeWorkspaceId: activeWorkspace?.id ?? null,
      role,
      aiMode: bootstrap?.aiMode ?? null,
      ticketCounts: bootstrap?.ticketCounts ?? {
        open: 0,
        pendingDecisions: 0,
        approvedDecisions: 0,
      },
      loading,
      error,
      refresh,
      refreshProjects,
      switchWorkspace,
      canManageWorkspace: role === "owner" || role === "admin" || role === "manager",
    }),
    [
      bootstrap,
      workspaces,
      activeWorkspace,
      activeOrganization,
      role,
      loading,
      error,
      refresh,
      refreshProjects,
      switchWorkspace,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return value;
}
