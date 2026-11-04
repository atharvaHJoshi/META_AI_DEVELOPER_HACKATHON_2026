import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bell,
  Building2,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Code2,
  FileText,
  FolderKanban,
  GitCompareArrows,
  History,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import type { NotificationFeed } from "@miraiwerk/schemas";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import { cn, hasRole, initials, relativeTime, roleLabel } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Avatar, Badge, IconButton, LoadingBlock, Modal, Spinner, Tooltip } from "./ui";

type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  minimumRole?: "member" | "manager" | "admin";
  end?: boolean;
};

type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", to: "/", icon: LayoutDashboard, end: true },
      { label: "Projects", to: "/projects", icon: FolderKanban },
      { label: "Tasks & Sprints", to: "/tasks", icon: ListChecks, minimumRole: "member" },
      { label: "Roadmaps & Milestones", to: "/roadmap", icon: CalendarRange },
      { label: "Teams & Workload", to: "/teams", icon: UsersRound },
    ],
  },
  {
    label: "Change intelligence",
    items: [
      { label: "AI Plan Generator", to: "/ai/plan", icon: Sparkles, minimumRole: "member" },
      { label: "Ticket Inbox", to: "/tickets", icon: Inbox, minimumRole: "member" },
      { label: "RippleMap", to: "/ripplemap", icon: GitCompareArrows },
      { label: "Decision & Plan History", to: "/history", icon: History },
    ],
  },
  {
    label: "Collaboration",
    items: [
      { label: "Documentation & Diagrams", to: "/docs", icon: FileText, minimumRole: "member" },
      { label: "Meetings", to: "/meetings", icon: Video, minimumRole: "member" },
      { label: "Code Workspace", to: "/code", icon: Code2, minimumRole: "member" },
      { label: "Discussions", to: "/discussions", icon: MessagesSquare, minimumRole: "member" },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Organization & Workspaces", to: "/organization", icon: Building2, minimumRole: "manager" },
      { label: "Roles & Permissions", to: "/roles", icon: ShieldCheck, minimumRole: "admin" },
      { label: "Audit Logs", to: "/audit", icon: ShieldCheck, minimumRole: "admin" },
      { label: "Settings & AI", to: "/settings", icon: Settings2 },
    ],
  },
];

const SIDEBAR_KEY = "miraiwerk.sidebar_collapsed";

function NavEntry({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "group flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
          isActive
            ? "bg-primary-50 text-primary-700"
            : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
          collapsed && "justify-center px-0",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );

  return collapsed ? <Tooltip label={item.label}>{link}</Tooltip> : link;
}

function WorkspaceSwitcher() {
  const { organizations, workspaces, activeWorkspace, activeOrganization, switchWorkspace } = useWorkspace();
  const [switching, setSwitching] = useState(false);

  const handleSwitch = async (id: string) => {
    if (id === activeWorkspace?.id) return;
    setSwitching(true);
    try {
      await switchWorkspace(id);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          aria-label="Switch workspace"
          disabled={switching}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary-50 text-[10px] font-bold text-primary-700">
            {activeOrganization ? initials(activeOrganization.name) : "MW"}
          </span>
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block max-w-[170px] truncate text-xs font-semibold text-ink">
              {activeWorkspace?.name ?? "No workspace"}
            </span>
            <span className="block max-w-[170px] truncate text-[10px] text-ink-faint">
              {activeOrganization?.name ?? "Select organization"}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-[65] w-72 rounded-lg border border-line bg-surface p-1.5 shadow-popover animate-slide-up"
        >
          <p className="px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
            Workspaces
          </p>
          {workspaces.map((workspace) => {
            const org = organizations.find((organization) => organization.id === workspace.organizationId);
            return (
              <DropdownMenu.Item
                key={workspace.id}
                onSelect={() => void handleSwitch(workspace.id)}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface-sunken text-[10px] font-bold text-ink-muted">
                  {initials(workspace.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-ink">{workspace.name}</span>
                  <span className="block truncate text-[10px] text-ink-faint">
                    {org?.name ?? "Organization"} · {roleLabel(workspace.role)}
                  </span>
                </span>
                {workspace.id === activeWorkspace?.id && <Check className="h-3.5 w-3.5 text-primary-600" />}
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild>
            <Link
              to="/organization"
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-ink-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
            >
              <Building2 className="h-3.5 w-3.5" /> Manage workspaces
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { role } = useWorkspace();

  if (!user) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md p-1 transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          aria-label="Open account menu"
        >
          <Avatar name={user.name} color={user.avatarColor} size="sm" />
          <span className="hidden text-left leading-tight lg:block">
            <span className="block max-w-[140px] truncate text-xs font-semibold text-ink">{user.name}</span>
            <span className="block text-[10px] text-ink-faint">{roleLabel(role)}</span>
          </span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-ink-faint lg:block" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[65] w-60 rounded-lg border border-line bg-surface p-1.5 shadow-popover animate-slide-up"
        >
          <div className="px-2.5 py-2">
            <p className="text-sm font-semibold text-ink">{user.name}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
            <p className="mt-1 text-[10px] text-ink-faint">{user.title || roleLabel(role)}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            onSelect={() => navigate("/settings")}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-ink-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
          >
            <Settings2 className="h-3.5 w-3.5" /> Profile & settings
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => navigate("/organization")}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-ink-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
          >
            <Building2 className="h-3.5 w-3.5" /> Organization
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            onSelect={() => {
              void logout();
              navigate("/login");
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-danger-600 outline-none hover:bg-danger-50 focus:bg-danger-50"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { projects } = useWorkspace();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return projects.slice(0, 5);
    return projects
      .filter(
        (project) =>
          project.name.toLowerCase().includes(value) ||
          project.goal.toLowerCase().includes(value) ||
          project.description.toLowerCase().includes(value),
      )
      .slice(0, 8);
  }, [projects, query]);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
      title="Search projects"
      description="Find a project by name or goal. Module destinations remain available in the sidebar."
      size="lg"
    >
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-2">
        <Search className="h-4 w-4 text-ink-faint" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects by name or goal…"
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          aria-label="Search projects"
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) {
              navigate(`/projects/${results[0].id}`);
              setQuery("");
              onOpenChange(false);
            }
          }}
        />
      </div>
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {results.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">No projects match “{query}”.</p>
        ) : (
          <ul className="divide-y divide-line-faint">
            {results.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  onClick={() => {
                    navigate(`/projects/${project.id}`);
                    setQuery("");
                    onOpenChange(false);
                  }}
                  className="w-full rounded-md px-2 py-3 text-left hover:bg-surface-muted focus-visible:bg-surface-muted"
                >
                  <p className="text-sm font-semibold text-ink">{project.name}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{project.goal}</p>
                  <p className="mt-1 font-mono text-[10px] text-ink-faint">
                    Plan v{project.currentPlanVersion} · {project.taskCount} tasks · {project.pendingDecisionCount} pending
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function NotificationMenu() {
  const { activeWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const workspaceId = activeWorkspace?.id ?? "";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const [limit, setLimit] = useState(8);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const feed = useAsync<NotificationFeed>(
    () =>
      workspaceId
        ? api.notifications.list({ status: tab, limit })
        : Promise.resolve({ notifications: [], unreadCount: 0, hasMore: false }),
    [workspaceId, tab, limit],
  );

  useEffect(() => {
    if (open) void feed.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const unread = feed.data?.unreadCount ?? 0;
  const notifications = feed.data?.notifications ?? [];

  const selectTab = (next: "unread" | "all") => {
    if (next !== tab) {
      setTab(next);
      setLimit(8);
    }
  };

  const openNotification = async (notificationId: string, link: string, isRead: boolean) => {
    setActionError(null);
    if (!isRead) {
      setActionBusy(notificationId);
      try {
        await api.notifications.markRead(notificationId);
        await feed.reload();
      } catch {
        setActionError("This notification could not be marked as read.");
      } finally {
        setActionBusy(null);
      }
    }
    setOpen(false);
    if (link.startsWith("/")) navigate(link);
  };

  const markAllRead = async () => {
    setActionBusy("all");
    setActionError(null);
    try {
      await api.notifications.markAllRead();
      await feed.reload();
    } catch {
      setActionError("Notifications could not be marked as read.");
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[9px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[65] w-[22rem] rounded-lg border border-line bg-surface p-1.5 shadow-popover animate-slide-up"
        >
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              Notifications
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={actionBusy === "all"}
                className="text-[10px] font-semibold text-primary-600 hover:underline disabled:opacity-60"
              >
                {actionBusy === "all" ? "Marking…" : "Mark all read"}
              </button>
            )}
          </div>

          <div className="mb-1 flex gap-1 rounded-md bg-surface-muted p-1">
            <DropdownMenu.Item
              onSelect={(event) => {
                event.preventDefault();
                selectTab("unread");
              }}
              className={cn(
                "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold outline-none",
                tab === "unread" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              Unread
              {unread > 0 && <Badge tone="primary">{unread}</Badge>}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={(event) => {
                event.preventDefault();
                selectTab("all");
              }}
              className={cn(
                "flex flex-1 cursor-pointer items-center justify-center rounded px-2 py-1 text-[11px] font-semibold outline-none",
                tab === "all" ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              All
            </DropdownMenu.Item>
          </div>

          {actionError && (
            <p className="mx-2 mb-1 rounded bg-danger-50 px-2 py-1.5 text-[10px] text-danger-600" role="alert">
              {actionError}
            </p>
          )}

          <div className="max-h-[22rem] overflow-y-auto">
            {feed.loading ? (
              <div className="py-6"><LoadingBlock label="Loading notifications" /></div>
            ) : feed.error ? (
              <p className="px-3 py-6 text-center text-xs text-danger-600">{feed.error}</p>
            ) : notifications.length === 0 ? (
              <div className="px-3 py-7 text-center">
                <Bell className="mx-auto h-5 w-5 text-ink-faint" />
                <p className="mt-2 text-xs font-semibold text-ink">
                  {tab === "unread" ? "You are all caught up" : "No notifications yet"}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-faint">
                  Task, decision, meeting and mention updates appear here.
                </p>
              </div>
            ) : (
              notifications.map((notification) => (
                <DropdownMenu.Item
                  key={notification.id}
                  onSelect={() =>
                    void openNotification(
                      notification.id,
                      notification.link,
                      notification.isRead,
                    )
                  }
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2.5 outline-none hover:bg-surface-sunken focus:bg-surface-sunken",
                    notification.isRead && "opacity-70",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      notification.isRead ? "bg-line-strong" : "bg-primary-500",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-ink">{notification.title}</span>
                      {actionBusy === notification.id && <Spinner className="h-3 w-3 shrink-0" />}
                    </span>
                    {notification.message && (
                      <span className="mt-0.5 block line-clamp-2 text-[11px] leading-5 text-ink-muted">
                        {notification.message}
                      </span>
                    )}
                    <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.08em] text-ink-faint">
                      {relativeTime(notification.createdAt)}
                    </span>
                  </span>
                </DropdownMenu.Item>
              ))
            )}
          </div>

          {feed.data?.hasMore && (
            <DropdownMenu.Item
              onSelect={(event) => {
                event.preventDefault();
                setLimit((current) => current + 8);
              }}
              className="mt-1 cursor-pointer rounded-md border-t border-line px-2.5 py-2 text-center text-[11px] font-semibold text-primary-600 outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
            >
              Load more
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            onSelect={() => navigate("/settings")}
            className="cursor-pointer rounded-md px-2.5 py-2 text-center text-[11px] font-medium text-ink-muted outline-none hover:bg-surface-sunken focus:bg-surface-sunken"
          >
            Notification preferences
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function useBreadcrumbs() {
  const location = useLocation();
  const { projects, activeWorkspace } = useWorkspace();
  return useMemo(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return [{ label: "Overview" }];
    const labels: Record<string, string> = {
      projects: "Projects",
      tasks: "Tasks & Sprints",
      roadmap: "Roadmaps & Milestones",
      teams: "Teams & Workload",
      ai: "AI Plan Generator",
      plan: "Plan Generator",
      tickets: "Ticket Inbox",
      ripplemap: "RippleMap",
      history: "Decision & Plan History",
      docs: "Documentation & Diagrams",
      meetings: "Meetings",
      code: "Code Workspace",
      discussions: "Discussions",
      organization: "Organization & Workspaces",
      roles: "Roles & Permissions",
      audit: "Audit Logs",
      settings: "Settings & AI",
      new: "New",
    };
    const crumbs: Array<{ label: string; to?: string }> = [];
    if (activeWorkspace) crumbs.push({ label: activeWorkspace.name });
    segments.forEach((segment, index) => {
      const project = projects.find((candidate) => candidate.id === segment);
      const label = project?.name ?? labels[segment] ?? (segment.startsWith("prj_") ? "Project" : "Detail");
      crumbs.push({ label, to: `/${segments.slice(0, index + 1).join("/")}` });
    });
    return crumbs;
  }, [location.pathname, projects, activeWorkspace]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { role, activeWorkspace, aiMode, loading } = useWorkspace();
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_KEY) === "true");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const crumbs = useBreadcrumbs();

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.minimumRole || hasRole(role, item.minimumRole)),
  })).filter((group) => group.items.length > 0);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-14 items-center border-b border-line", collapsed ? "justify-center px-2" : "px-4")}>
        <Link to="/" className="flex items-center gap-2.5" aria-label="MIRAIWERK AI home">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-500 text-[11px] font-bold tracking-tight text-white">
            MW
          </span>
          {!collapsed && (
            <span className="leading-tight">
              <span className="block text-sm font-bold tracking-tight text-ink">MIRAIWERK</span>
              <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-ink-faint">
                Project intelligence
              </span>
            </span>
          )}
        </Link>
        {!collapsed && (
          <IconButton
            label="Collapse sidebar"
            onClick={() => setCollapsed(true)}
            className="ml-auto hidden lg:inline-flex"
          >
            <PanelLeftClose className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Primary navigation">
        {visibleGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="mb-1.5 px-2.5 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavEntry
                  key={item.to}
                  item={item}
                  collapsed={collapsed}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn("border-t border-line p-2.5", collapsed && "flex justify-center")}>
        {collapsed ? (
          <Tooltip
            label={
              aiMode?.usesGemini
                ? "Gemini connected"
                : aiMode?.usesMeta
                  ? "Meta model connected"
                  : "Deterministic fallback active"
            }
          >
            <span
              className={cn(
                "block h-2.5 w-2.5 rounded-full",
                aiMode?.usesGemini ? "bg-sage-500" : aiMode?.usesMeta ? "bg-primary-500" : "bg-warning-500",
              )}
              aria-label={aiMode?.label ?? "AI status"}
            />
          </Tooltip>
        ) : (
          <div className="rounded-md border border-line bg-surface-muted p-2.5">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  aiMode?.usesGemini ? "bg-sage-500" : aiMode?.usesMeta ? "bg-primary-500" : "bg-warning-500",
                )}
              />
              <p className="text-[11px] font-semibold text-ink">
                {aiMode?.usesGemini ? "Gemini connected" : aiMode?.usesMeta ? "Meta model connected" : "Deterministic mode"}
              </p>
            </div>
            <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-ink-faint">
              {aiMode?.label ?? "AI status loads with the workspace."}
            </p>
            <Link to="/settings" className="mt-1.5 inline-block text-[10px] font-semibold text-primary-600 hover:underline">
              AI configuration
            </Link>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-popover">
        Skip to main content
      </a>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-line bg-surface transition-[width] duration-200 lg:block",
          collapsed ? "w-[60px]" : "w-[240px]",
        )}
        aria-label="Sidebar"
      >
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-ink/25"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[260px] border-r border-line bg-surface shadow-popover animate-slide-up" aria-label="Mobile navigation">
            {sidebar}
          </aside>
        </div>
      )}

      <div className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-[60px]" : "lg:pl-[240px]")}>
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
            <IconButton label="Open navigation" className="lg:hidden" onClick={() => setMobileOpen(true)}>
              <Menu className="h-4 w-4" />
            </IconButton>
            {collapsed && (
              <IconButton
                label="Expand sidebar"
                className="hidden lg:inline-flex"
                onClick={() => setCollapsed(false)}
              >
                <PanelLeftOpen className="h-4 w-4" />
              </IconButton>
            )}
            <WorkspaceSwitcher />
            <div className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-2 text-xs text-ink-faint xl:flex">
              {crumbs.map((crumb, index) => (
                <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                  {index > 0 && <span aria-hidden>/</span>}
                  {crumb.to && index < crumbs.length - 1 ? (
                    <Link to={crumb.to} className="truncate hover:text-ink">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={cn("truncate", index === crumbs.length - 1 && "font-medium text-ink-muted")}>
                      {crumb.label}
                    </span>
                  )}
                </span>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="hidden h-9 w-full max-w-md items-center gap-2 rounded-md border border-line bg-surface-muted px-3 text-left text-xs text-ink-faint transition-colors hover:border-line-strong hover:bg-surface md:flex"
              >
                <Search className="h-3.5 w-3.5" aria-hidden />
                <span className="flex-1">Search projects and modules</span>
                <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
              </button>
              <IconButton label="Search" className="md:hidden" onClick={() => setSearchOpen(true)}>
                <Search className="h-4 w-4" />
              </IconButton>
              <NotificationMenu />
              <div className="mx-1 hidden h-6 w-px bg-line sm:block" />
              <UserMenu />
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
          {loading ? (
            <div className="py-16">
              <LoadingBlock label="Loading workspace context" />
            </div>
          ) : !activeWorkspace && user ? (
            <div className="rounded-lg border border-line bg-surface p-6">
              <h1 className="text-lg font-semibold text-ink">No workspace yet</h1>
              <p className="mt-1 text-sm text-ink-muted">
                Create an organization and first workspace to start planning work.
              </p>
              <Link to="/onboarding" className="btn-primary mt-4 inline-flex">
                Start onboarding
              </Link>
            </div>
          ) : (
            children
          )}
        </main>
        <footer className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 pb-6 text-[10px] text-ink-faint sm:px-6 lg:px-8">
          <span>MIRAIWERK AI · deterministic change intelligence · human approval required</span>
          <span className="font-mono">Plan changes only after authorized approval</span>
        </footer>
      </div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
