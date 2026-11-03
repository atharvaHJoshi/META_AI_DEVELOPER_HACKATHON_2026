import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  Clock3,
  GitCompareArrows,
  Inbox,
  ListChecks,
  Plus,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { ProjectPlan, TicketListItem } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { useAuth } from "../context/AuthContext";
import { api, type DecisionQueueItem, type WorkspaceWorkload } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  PriorityBadge,
  ProgressBar,
  StatCard,
  StatusBadge,
} from "../components/ui";
import { daysUntil, formatShortDate, hasRole, relativeTime, truncate } from "../lib/format";

interface DashboardData {
  plans: Array<{ plan: ProjectPlan }>;
  decisions: DecisionQueueItem[];
  tickets: TicketListItem[];
  workload: WorkspaceWorkload[];
}

export function OverviewPage() {
  const { projects, activeWorkspace, role, ticketCounts, aiMode, loading: workspaceLoading, error: workspaceError } =
    useWorkspace();
  const { user } = useAuth();
  const projectIds = projects.map((project) => project.id).join(",");

  const { data, loading, error, reload } = useAsync<DashboardData>(async () => {
    const [plans, decisions, workload, ticketGroups] = await Promise.all([
      Promise.allSettled(projects.map((project) => api.projects.getPlan(project.id))),
      api.decisions.list("pending").catch(() => ({ decisions: [] })),
      activeWorkspace ? api.workspaces.workload(activeWorkspace.id).catch(() => ({ workload: [] })) : Promise.resolve({ workload: [] }),
      Promise.all(projects.map((project) => api.tickets.list(project.id).catch(() => ({ tickets: [] })))),
    ]);
    return {
      plans: plans
        .filter((result): result is PromiseFulfilledResult<ProjectPlan> => result.status === "fulfilled")
        .map((result) => ({ plan: result.value })),
      decisions: decisions.decisions,
      tickets: ticketGroups.flatMap((group) => group.tickets),
      workload: workload.workload,
    };
  }, [activeWorkspace?.id, projectIds]);

  const metrics = useMemo(() => {
    const tasks = data?.plans.flatMap((item) => item.plan.tasks) ?? [];
    const openTasks = tasks.filter((task) => task.status !== "done");
    const doneTasks = tasks.filter((task) => task.status === "done");
    const blocked = openTasks.filter((task) => task.status === "blocked");
    const today = new Date().toISOString().slice(0, 10);
    const overdue = openTasks.filter((task) => task.plannedFinish && task.plannedFinish < today);
    const capacity = data?.plans.reduce((sum, item) => {
      const value = item.plan.constraints.capacityPersonDays;
      return sum + (typeof value === "number" ? value : 0);
    }, 0) ?? 0;
    const scheduled = openTasks.reduce((sum, task) => sum + task.estimateDays, 0);
    const milestones = (data?.plans ?? []).flatMap((item) =>
      item.plan.milestones.map((milestone) => ({
        ...milestone,
        projectName: item.plan.project.name,
        projectId: item.plan.project.id,
      })),
    );
    const upcoming = milestones
      .filter((milestone) => milestone.targetDate)
      .sort((a, b) => (a.targetDate ?? "").localeCompare(b.targetDate ?? ""))
      .slice(0, 6);
    return {
      tasks,
      openTasks,
      doneTasks,
      blocked,
      overdue,
      capacity,
      scheduled,
      milestones,
      upcoming,
      questionTickets: data?.tickets.filter((ticket) => ["needs_clarification", "analysis_failed"].includes(ticket.status)) ?? [],
      progress: tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0,
    };
  }, [data]);

  const attention = useMemo(() => {
    const items: Array<{
      title: string;
      detail: string;
      to: string;
      tone: "danger" | "amber" | "primary";
      label: string;
    }> = [];
    if (data?.decisions.length) {
      for (const decision of data.decisions.slice(0, 3)) {
        items.push({
          title: decision.ticketTitle,
          detail: `${decision.projectName} · RippleMap impact awaits authorized approval`,
          to: `/ripplemap/${decision.id}`,
          tone: decision.recommendation === "accept" ? "amber" : "primary",
          label: "Decision",
        });
      }
    }
    for (const issue of metrics.questionTickets.slice(0, 2)) {
      items.push({
        title: issue.title,
        detail: `${issue.status === "analysis_failed" ? "Analysis failed" : "Needs clarification"} · ${issue.missingEvidenceCount} missing evidence item(s)`,
        to: `/tickets/${issue.id}`,
        tone: "amber",
        label: "Ticket",
      });
    }
    for (const task of metrics.blocked.slice(0, 2)) {
      const project = projects.find((candidate) => candidate.id === task.projectId);
      items.push({
        title: task.title,
        detail: `${project?.name ?? "Project"} · blocked ${task.priority} task`,
        to: `/tasks?project=${task.projectId}&task=${task.id}`,
        tone: "danger",
        label: "Blocked",
      });
    }
    return items;
  }, [data, metrics, projects]);

  if (workspaceLoading || loading) {
    return (
      <div>
        <PageHeader title="Overview" description="Loading workspace signals…" />
        <LoadingBlock label="Loading project health" />
      </div>
    );
  }

  if (workspaceError || error) {
    return (
      <div>
        <PageHeader title="Overview" />
        <ErrorBlock message={workspaceError ?? error ?? "Unknown error"} onRetry={reload} />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div>
        <PageHeader
          title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${user?.name.split(" ")[0] ?? "there"}`}
          description="This workspace has no projects yet. Generate a plan with Gemini or deterministic rules, review the assumptions, then create the project."
        />
        <Card>
          <EmptyState
            icon={Sparkles}
            title="Start with a project plan"
            description="The AI Plan Generator turns your goal and constraints into requirements, tasks and milestones. Nothing is committed until you review and create the project."
            action={
              hasRole(role, "member") ? (
                <Link to="/ai/plan" className="btn-primary">
                  <Plus className="h-4 w-4" /> Generate a plan
                </Link>
              ) : (
                <p className="text-xs text-ink-muted">Ask a member, manager or owner to create the first project.</p>
              )
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className={aiMode?.usesGemini ? "h-1.5 w-1.5 rounded-full bg-sage-500" : "h-1.5 w-1.5 rounded-full bg-warning-500"} />
              {aiMode?.label ?? "AI status loading"}
            </span>
            <span className="text-line-strong">·</span>
            <span>{activeWorkspace?.name}</span>
          </>
        }
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${user?.name.split(" ")[0] ?? "there"}`}
        description="Project health, pending decisions and the work that needs attention across this workspace."
        actions={
          <>
            {hasRole(role, "member") && (
              <Link to="/tickets/new" className="btn-secondary">
                <Inbox className="h-4 w-4" /> New ticket
              </Link>
            )}
            {hasRole(role, "member") && (
              <Link to="/ai/plan" className="btn-primary">
                <Sparkles className="h-4 w-4" /> Generate plan
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active projects"
          value={projects.length}
          hint={`${metrics.tasks.length} tasks · ${metrics.progress}% complete`}
          icon={ListChecks}
          tone="primary"
        />
        <StatCard
          label="Pending decisions"
          value={ticketCounts.pendingDecisions}
          hint="RippleMap impact must be reviewed before approval."
          icon={GitCompareArrows}
          tone={ticketCounts.pendingDecisions > 0 ? "amber" : "sage"}
        />
        <StatCard
          label="Open tickets"
          value={ticketCounts.open}
          hint={`${metrics.questionTickets.length} need clarification or retry`}
          icon={Inbox}
          tone={metrics.questionTickets.length > 0 ? "amber" : "neutral"}
        />
        <StatCard
          label="Blocked or overdue"
          value={metrics.blocked.length + metrics.overdue.length}
          hint={metrics.capacity > 0 ? `${Math.round((metrics.scheduled / metrics.capacity) * 100)}% of stated capacity scheduled` : "No stated capacity in plan constraints"}
          icon={AlertTriangle}
          tone={metrics.blocked.length + metrics.overdue.length > 0 ? "danger" : "sage"}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Project health"
              description="Derived from the current plan version and operational task state."
              actions={<Link to="/projects" className="text-xs font-semibold text-primary-600 hover:underline">All projects</Link>}
            />
            <div className="divide-y divide-line-faint">
              {projects.map((project) => {
                const planItem = data?.plans.find((item) => item.plan.project.id === project.id);
                const tasks = planItem?.plan.tasks ?? [];
                const open = tasks.filter((task) => task.status !== "done");
                const blocked = open.filter((task) => task.status === "blocked");
                const today = new Date().toISOString().slice(0, 10);
                const overdue = open.filter((task) => task.plannedFinish && task.plannedFinish < today);
                const done = tasks.filter((task) => task.status === "done").length;
                const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
                const health = blocked.length > 0 || overdue.length > 0 ? "At risk" : progress >= 70 ? "On track" : "Watch";
                return (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="block px-5 py-4 transition-colors hover:bg-surface-muted"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-ink">{project.name}</p>
                          <Badge tone={health === "At risk" ? "danger" : health === "On track" ? "sage" : "amber"} dot>
                            {health}
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs text-ink-muted">{project.goal}</p>
                      </div>
                      <span className="font-mono text-[10px] text-ink-faint">Plan v{project.currentPlanVersion}</span>
                    </div>
                    <div className="mt-3 grid items-center gap-3 sm:grid-cols-[1fr_auto]">
                      <ProgressBar value={progress} label={`${done}/${tasks.length || project.taskCount} tasks complete`} tone={health === "At risk" ? "danger" : "primary"} />
                      <div className="flex flex-wrap gap-2 text-[10px] text-ink-faint">
                        <span>{project.pendingDecisionCount} decisions</span>
                        <span>·</span>
                        <span>{project.openTicketCount} tickets</span>
                        <span>·</span>
                        <span>{project.memberCount} members</span>
                      </div>
                    </div>
                    {project.nextMilestone && (
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-muted">
                        <CalendarRange className="h-3 w-3" />
                        Next: {project.nextMilestone.title} · {formatShortDate(project.nextMilestone.targetDate)}
                        {project.nextMilestone.releaseGate && <Badge tone="outline">Release gate</Badge>}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Upcoming milestones"
              description="Target dates from the current approved plan. Empty dates are intentionally unknown."
              actions={<Link to="/roadmap" className="text-xs font-semibold text-primary-600 hover:underline">Open roadmap</Link>}
            />
            {metrics.upcoming.length === 0 ? (
              <EmptyState icon={CalendarRange} title="No dated milestones" description="Milestones without target dates are not plotted as upcoming." compact />
            ) : (
              <ul className="divide-y divide-line-faint">
                {metrics.upcoming.map((milestone) => {
                  const delta = daysUntil(milestone.targetDate);
                  return (
                    <li key={milestone.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink">{milestone.title}</p>
                        <p className="mt-0.5 text-[10px] text-ink-faint">{milestone.projectName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {milestone.releaseGate && <Badge tone="outline">Release gate</Badge>}
                        <Badge tone={delta !== null && delta < 0 ? "danger" : delta !== null && delta <= 7 ? "amber" : "neutral"}>
                          {formatShortDate(milestone.targetDate)}
                          {delta !== null && ` · ${delta < 0 ? `${Math.abs(delta)}d overdue` : `${delta}d`}`}
                        </Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Needs attention" description="Prioritized actions, newest decision first." />
            {attention.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Nothing urgent" description="No pending decisions, blocked tasks or clarification requests in this workspace." compact />
            ) : (
              <ul className="divide-y divide-line-faint">
                {attention.map((item, index) => (
                  <li key={`${item.to}-${index}`}>
                    <Link to={item.to} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-muted">
                      <span
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                          item.tone === "danger" ? "bg-danger-50 text-danger-600" : item.tone === "amber" ? "bg-warning-50 text-warning-600" : "bg-primary-50 text-primary-600"
                        }`}
                      >
                        {item.tone === "danger" ? <AlertTriangle className="h-3 w-3" /> : item.tone === "amber" ? <Clock3 className="h-3 w-3" /> : <GitCompareArrows className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{item.label}</span>
                          <span className="text-[10px] text-ink-faint">{relativeTime(data?.decisions[0]?.createdAt)}</span>
                        </span>
                        <span className="mt-0.5 block text-xs font-semibold text-ink">{truncate(item.title, 90)}</span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-ink-muted">{item.detail}</span>
                      </span>
                      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Workload"
              description="Open task estimates by workspace member. Capacity is not fabricated."
              actions={<Link to="/teams" className="text-xs font-semibold text-primary-600 hover:underline">Details</Link>}
            />
            {data?.workload.length ? (
              <ul className="space-y-3 px-5 py-4">
                {data.workload.slice(0, 6).map((member) => {
                  const max = Math.max(...(data.workload.map((item) => item.estimateDays) ?? [1]), 1);
                  return (
                    <li key={member.userId}>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-ink">{member.name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-ink-faint">{member.estimateDays}d · {member.openTasks} open</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                          <div className="h-full rounded-full bg-primary-400" style={{ width: `${Math.min(100, (member.estimateDays / max) * 100)}%` }} />
                        </div>
                        {member.blockedTasks > 0 && <Badge tone="danger">{member.blockedTasks} blocked</Badge>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={UsersRound} title="No assigned workload" description="Assign tasks to workspace members to see estimates here." compact />
            )}
          </Card>

          <Card>
            <CardHeader title="Recent tickets" description="Latest intake in this workspace." actions={<Link to="/tickets" className="text-xs font-semibold text-primary-600 hover:underline">Inbox</Link>} />
            {data?.tickets.length ? (
              <ul className="divide-y divide-line-faint">
                {data.tickets.slice(0, 4).map((ticket) => (
                  <li key={ticket.id}>
                    <Link to={`/tickets/${ticket.id}`} className="block px-5 py-3 hover:bg-surface-muted">
                      <div className="flex items-center justify-between gap-2">
                        <p className="line-clamp-1 text-xs font-semibold text-ink">{ticket.title}</p>
                        <PriorityBadge priority={ticket.latestPriority ?? (ticket.severityReported === "critical" ? "P0" : null)} />
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusBadge status={ticket.status} />
                        {ticket.missingEvidenceCount > 0 && <span className="text-[10px] text-warning-600">{ticket.missingEvidenceCount} missing evidence</span>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Inbox} title="No tickets yet" description="Create a ticket to start the change-intelligence workflow." compact />
            )}
          </Card>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-4 py-3 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary-500" />
          AI outputs are labelled. Deterministic fallback is always identified; no Gemini claim is made without a Gemini response.
        </span>
        <Link to="/settings" className="font-semibold text-primary-600 hover:underline">AI configuration</Link>
      </div>
    </div>
  );
}
