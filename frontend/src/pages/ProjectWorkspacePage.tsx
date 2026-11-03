import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarRange,
  GitBranch,
  GitCompareArrows,
  Inbox,
  LayoutGrid,
  List,
  Milestone,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import type { BoardTask, ProjectPlan } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { formatDate, formatShortDate, hasRole, titleCase } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  PriorityBadge,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui";
import { TaskBoard } from "./project/TaskBoard";
import { DependenciesView, ProjectHistoryView, ProjectOverview, RoadmapView } from "./project/ProjectSections";

interface ProjectData {
  plan: ProjectPlan;
  tasks: BoardTask[];
}

export function ProjectWorkspacePage() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const { activeWorkspace } = useWorkspace();
  const { data, loading, error, reload } = useAsync<ProjectData>(async () => {
    const [plan, taskResult] = await Promise.all([
      api.projects.getPlan(projectId),
      api.tasks.list(projectId),
    ]);
    return { plan, tasks: taskResult.tasks };
  }, [projectId]);

  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", value);
    setParams(next, { replace: true });
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Project workspace" description="Loading the approved plan and operational task state…" />
        <LoadingBlock label="Loading project" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader
          eyebrow={<Link to="/projects" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> Projects</Link>}
          title="Project unavailable"
        />
        <ErrorBlock message={error ?? "The project could not be loaded."} onRetry={reload} />
      </div>
    );
  }

  const { plan, tasks } = data;
  const canEdit = hasRole(plan.project.role, "member");
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const done = tasks.filter((task) => task.status === "done").length;

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Link to="/projects" className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft className="h-3.5 w-3.5" /> Projects
            </Link>
            <span className="text-line-strong">/</span>
            <span>{activeWorkspace?.name}</span>
            <span className="text-line-strong">·</span>
            <span className="font-mono">Plan v{plan.version}</span>
          </>
        }
        title={plan.project.name}
        description={plan.project.goal}
        actions={
          <>
            <Button variant="ghost" onClick={() => void reload()} aria-label="Refresh project">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            {canEdit && (
              <Link to={`/tickets/new?project=${plan.project.id}`} className="btn-secondary">
                <Inbox className="h-4 w-4" /> New ticket
              </Link>
            )}
            <Link to="/ripplemap" className="btn-primary">
              <GitCompareArrows className="h-4 w-4" /> RippleMap
            </Link>
          </>
        }
        meta={
          <>
            <Badge tone="outline">{titleCase(plan.project.status)}</Badge>
            <Badge tone="neutral">{titleCase(plan.project.role)}</Badge>
            <span className="inline-flex items-center gap-1"><CalendarRange className="h-3 w-3" /> {formatDate(plan.project.startDate)} → {formatDate(plan.project.targetDate)}</span>
            <span className="inline-flex items-center gap-1"><UsersRound className="h-3 w-3" /> {plan.project.memberCount} members</span>
            <span className="inline-flex items-center gap-1"><List className="h-3 w-3" /> {tasks.length} tasks · {done} done</span>
            {blocked > 0 && <Badge tone="danger" dot>{blocked} blocked</Badge>}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">Task board</TabsTrigger>
          <TabsTrigger value="list">List view</TabsTrigger>
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <ProjectOverview plan={plan} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="tasks">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-muted">Accessible Kanban. Use the status selector on each card to move work without drag-and-drop.</p>
            <Link to={`/tickets?project=${plan.project.id}`} className="text-xs font-semibold text-primary-600 hover:underline">Project tickets</Link>
          </div>
          <TaskBoard
            projectId={plan.project.id}
            tasks={tasks}
            milestones={plan.milestones}
            canEdit={canEdit}
            onRefresh={reload}
          />
        </TabsContent>
        <TabsContent value="list">
          <TaskList projectId={plan.project.id} tasks={tasks} canEdit={canEdit} onRefresh={reload} />
        </TabsContent>
        <TabsContent value="roadmap">
          <RoadmapView projectId={plan.project.id} plan={plan} tasks={tasks} />
        </TabsContent>
        <TabsContent value="dependencies">
          <DependenciesView projectId={plan.project.id} tasks={tasks} canEdit={canEdit} onRefresh={reload} />
        </TabsContent>
        <TabsContent value="history">
          <ProjectHistoryView projectId={plan.project.id} />
        </TabsContent>
      </Tabs>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { icon: Milestone, label: "Milestones", value: plan.milestones.length, to: "roadmap" },
          { icon: GitBranch, label: "Dependencies", value: tasks.reduce((sum, task) => sum + task.dependencyIds.length, 0), to: "dependencies" },
          { icon: GitCompareArrows, label: "Pending decisions", value: plan.project.pendingDecisionCount, to: "history" },
        ].map((item) => (
          <button key={item.label} type="button" onClick={() => setTab(item.to)} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-left hover:bg-surface-muted">
            <item.icon className="h-4 w-4 text-primary-500" />
            <span className="flex-1">
              <span className="block text-[10px] text-ink-faint">{item.label}</span>
              <span className="block text-sm font-semibold text-ink">{item.value}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskList({
  projectId,
  tasks,
  canEdit,
  onRefresh,
}: {
  projectId: string;
  tasks: BoardTask[];
  canEdit: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (status === "all" || task.status === status) &&
          (!query.trim() || `${task.title} ${task.description}`.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [tasks, query, status],
  );

  const change = async (task: BoardTask, next: BoardTask["status"]) => {
    try {
      await api.tasks.update(task.id, { status: next });
      await onRefresh();
    } catch (cause) {
      toast(cause instanceof ApiError ? cause.message : "Status could not be changed.", "error");
    }
  };

  if (tasks.length === 0) {
    return <Card><EmptyState icon={List} title="No tasks" description="This project has no tasks yet." compact /></Card>;
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter tasks…"
          className="field max-w-xs"
          aria-label="Filter task list"
        />
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="field w-auto" aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="planned">Planned</option>
          <option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
        <span className="ml-auto font-mono text-[10px] text-ink-faint">{filtered.length} of {tasks.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th className="table-head border-b border-line">Task</th>
              <th className="table-head border-b border-line">Status</th>
              <th className="table-head border-b border-line">Priority</th>
              <th className="table-head border-b border-line">Assignee</th>
              <th className="table-head border-b border-line">Milestone</th>
              <th className="table-head border-b border-line">Planned</th>
              <th className="table-head border-b border-line">Deps</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((task) => (
              <tr key={task.id} className="hover:bg-surface-muted">
                <td className="table-cell border-b border-line-faint">
                  <p className="text-xs font-semibold text-ink">{task.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-ink-faint">{task.description || "No description"}</p>
                </td>
                <td className="table-cell border-b border-line-faint">
                  {canEdit ? (
                    <select
                      value={task.status}
                      onChange={(event) => void change(task, event.target.value as BoardTask["status"])}
                      className="rounded border border-line bg-surface px-1.5 py-1 text-[10px] text-ink-muted"
                      aria-label={`Status for ${task.title}`}
                    >
                      <option value="planned">Planned</option>
                      <option value="in_progress">In progress</option>
                      <option value="blocked">Blocked</option>
                      <option value="done">Done</option>
                    </select>
                  ) : (
                    <StatusBadge status={task.status} />
                  )}
                </td>
                <td className="table-cell border-b border-line-faint"><PriorityBadge priority={task.priority} /></td>
                <td className="table-cell border-b border-line-faint text-xs">{task.assigneeName ?? "Unassigned"}</td>
                <td className="table-cell border-b border-line-faint text-xs">{task.milestoneTitle ?? "—"}</td>
                <td className="table-cell border-b border-line-faint font-mono text-[10px]">
                  {formatShortDate(task.plannedStart)} → {formatShortDate(task.plannedFinish)}
                </td>
                <td className="table-cell border-b border-line-faint font-mono text-[10px]">{task.dependencyIds.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <p className="px-4 py-8 text-center text-xs text-ink-muted">No tasks match the filter.</p>
      )}
      <p className="border-t border-line px-4 py-2 text-[10px] text-ink-faint">Project {projectId} · operational task changes are audit-logged.</p>
    </Card>
  );
}
