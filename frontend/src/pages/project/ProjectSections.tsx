import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  History,
  Link2,
  LockKeyhole,
  Milestone,
  Plus,
  ShieldAlert,
  Trash2,
  UsersRound,
} from "lucide-react";
import type { BoardTask, ProjectHistory, ProjectPlan } from "@miraiwerk/schemas";
import { useToast } from "../../context/ToastContext";
import { api, ApiError } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { daysUntil, formatDate, formatShortDate, relativeTime, titleCase } from "../../lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  LoadingBlock,
  Select,
  StatusBadge,
} from "../../components/ui";
import { useWorkspace } from "../../context/WorkspaceContext";

export function RoadmapView({
  projectId,
  plan,
  tasks,
}: {
  projectId: string;
  plan: ProjectPlan;
  tasks: BoardTask[];
}) {
  const [showTable, setShowTable] = useState(false);
  const dated = tasks.filter((task) => task.plannedStart && task.plannedFinish);
  const milestones = plan.milestones;

  const range = useMemo(() => {
    const values = [
      ...dated.flatMap((task) => [task.plannedStart!, task.plannedFinish!]),
      ...milestones.map((milestone) => milestone.targetDate).filter((value): value is string => Boolean(value)),
      new Date().toISOString().slice(0, 10),
    ].sort();
    const start = new Date(`${values[0]}T00:00:00`);
    const end = new Date(`${values[values.length - 1]}T00:00:00`);
    const padding = 3 * 86_400_000;
    return {
      start: new Date(start.getTime() - padding),
      end: new Date(end.getTime() + padding),
      total: Math.max(1, end.getTime() - start.getTime() + padding * 2),
    };
  }, [dated, milestones]);

  const position = (value: string) => {
    const date = new Date(`${value}T00:00:00`);
    return Math.min(100, Math.max(0, ((date.getTime() - range.start.getTime()) / range.total) * 100));
  };

  const width = (start: string, finish: string) => {
    const left = position(start);
    const right = position(finish);
    return Math.max(2, right - left);
  };

  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const milestoneStatus = milestones.map((milestone) => {
    const scoped = dated.filter((task) => task.milestoneId === milestone.id);
    const latest = scoped.map((task) => task.plannedFinish!).sort().at(-1) ?? null;
    let delta: number | null = null;
    if (latest && milestone.targetDate) {
      const targetDays = daysUntil(milestone.targetDate);
      const latestDays = daysUntil(latest);
      delta = (targetDays ?? 0) - (latestDays ?? 0);
    }
    const breached = Boolean(latest && milestone.targetDate && latest > milestone.targetDate);
    return { milestone, latest, breached, scoped };
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Plan timeline"
          description="Bars use planned dates from the current plan and operational task edits. Milestone flags use the approved target date."
          actions={
            <Button size="sm" variant="ghost" onClick={() => setShowTable((value) => !value)}>
              {showTable ? "Show timeline" : "Schedule table"}
            </Button>
          }
        />
        {dated.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="No scheduled tasks yet"
            description="This plan has no task start and finish dates. Add dates to tasks or approve a plan that includes a schedule."
            compact
          />
        ) : showTable ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="table-head border-b border-line">Task</th>
                  <th className="table-head border-b border-line">Milestone</th>
                  <th className="table-head border-b border-line">Start</th>
                  <th className="table-head border-b border-line">Finish</th>
                  <th className="table-head border-b border-line">Estimate</th>
                  <th className="table-head border-b border-line">Predecessors</th>
                </tr>
              </thead>
              <tbody>
                {dated.map((task) => (
                  <tr key={task.id}>
                    <td className="table-cell border-b border-line-faint font-medium text-ink">{task.title}</td>
                    <td className="table-cell border-b border-line-faint">{task.milestoneTitle ?? "—"}</td>
                    <td className="table-cell border-b border-line-faint font-mono text-xs">{task.plannedStart}</td>
                    <td className="table-cell border-b border-line-faint font-mono text-xs">{task.plannedFinish}</td>
                    <td className="table-cell border-b border-line-faint font-mono text-xs">{task.estimateDays}d</td>
                    <td className="table-cell border-b border-line-faint text-xs">
                      {task.dependencyIds.length ? task.dependencyIds.map((id) => taskById.get(id)?.title ?? id).join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            <div className="relative mb-2 h-8 border-b border-line">
              {milestones.filter((milestone) => milestone.targetDate).map((milestone) => (
                <div
                  key={milestone.id}
                  className="absolute top-0 -translate-x-1/2 text-center"
                  style={{ left: `${position(milestone.targetDate!)}%` }}
                  title={`${milestone.title} · ${formatDate(milestone.targetDate)}`}
                >
                  <span className="mx-auto block h-2.5 w-2.5 rotate-45 border border-primary-300 bg-primary-100" />
                  <span className="mt-1 hidden max-w-[100px] truncate text-[9px] text-ink-faint xl:block">{milestone.title}</span>
                </div>
              ))}
            </div>
            <div className="mb-2 flex justify-between font-mono text-[9px] text-ink-faint">
              <span>{formatShortDate(range.start.toISOString().slice(0, 10))}</span>
              <span>{formatShortDate(range.end.toISOString().slice(0, 10))}</span>
            </div>
            <ul className="space-y-1.5">
              {dated
                .slice()
                .sort((a, b) => (a.plannedStart ?? "").localeCompare(b.plannedStart ?? ""))
                .map((task) => {
                  const blocked = task.status === "blocked";
                  return (
                    <li key={task.id} className="grid grid-cols-[minmax(120px,1.1fr)_minmax(160px,3fr)] items-center gap-2">
                      <div className="min-w-0">
                        <Link to={`/tasks?project=${projectId}&task=${task.id}`} className="line-clamp-1 text-[11px] font-medium text-ink hover:text-primary-700 hover:underline">
                          {task.title}
                        </Link>
                        <p className="text-[9px] text-ink-faint">{task.assigneeName ?? "Unassigned"} · {task.estimateDays}d</p>
                      </div>
                      <div className="relative h-6 rounded bg-surface-muted">
                        <div
                          className={`absolute top-1 h-4 rounded-sm border ${
                            blocked
                              ? "border-danger-500/40 bg-danger-100"
                              : task.status === "done"
                                ? "border-sage-500/40 bg-sage-100"
                                : "border-primary-300 bg-primary-100"
                          }`}
                          style={{ left: `${position(task.plannedStart!)}%`, width: `${width(task.plannedStart!, task.plannedFinish!)}%` }}
                          title={`${task.title}: ${task.plannedStart} → ${task.plannedFinish}`}
                        >
                          <span className="sr-only">{task.plannedStart} to {task.plannedFinish}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
            <div className="mt-4 flex flex-wrap gap-3 border-t border-line-faint pt-3 text-[10px] text-ink-faint">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-primary-300 bg-primary-100" /> Planned / in progress</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-sage-500/40 bg-sage-100" /> Done</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-danger-500/40 bg-danger-100" /> Blocked</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rotate-45 border border-primary-300 bg-primary-100" /> Milestone target</span>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Milestone schedule" description="Target date compared with the latest planned finish in each milestone." />
          {milestoneStatus.length === 0 ? (
            <EmptyState icon={Milestone} title="No milestones" description="This project has no milestones." compact />
          ) : (
            <ul className="divide-y divide-line-faint">
              {milestoneStatus.map(({ milestone, latest, breached, scoped }) => (
                <li key={milestone.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-ink">{milestone.title}</p>
                    <div className="flex items-center gap-1.5">
                      {milestone.releaseGate && <Badge tone="outline">Release gate</Badge>}
                      {breached ? <Badge tone="danger" dot>Target breach</Badge> : <Badge tone="sage" dot>Within target</Badge>}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-ink-faint">
                    <span>Target {formatShortDate(milestone.targetDate)}</span>
                    <span>Planned finish {formatShortDate(latest)}</span>
                    <span>{scoped.length} scheduled tasks</span>
                  </div>
                  {breached && (
                    <p className="mt-1.5 text-[10px] text-danger-600">
                      Planned work extends beyond the approved milestone target. This is an observed schedule breach, not an AI inference.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Dependency chain" description="Direct predecessor relationships from the plan." />
          {tasks.every((task) => task.dependencyIds.length === 0) ? (
            <EmptyState icon={GitBranch} title="No dependencies" description="This project has no predecessor relationships." compact />
          ) : (
            <ul className="max-h-80 divide-y divide-line-faint overflow-y-auto">
              {tasks.filter((task) => task.dependencyIds.length > 0).map((task) => (
                <li key={task.id} className="px-5 py-2.5">
                  <p className="text-xs font-semibold text-ink">{task.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-ink-muted">
                    <Link2 className="h-3 w-3" />
                    {task.dependencyIds.map((id, index) => (
                      <span key={id}>
                        {index > 0 && <span className="mx-1 text-ink-faint">+</span>}
                        {taskById.get(id)?.title ?? id}
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export function DependenciesView({
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
  const [predecessor, setPredecessor] = useState("");
  const [successor, setSuccessor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const edges = tasks.flatMap((task) => task.dependencyIds.map((id) => ({ predecessor: id, successor: task.id })));

  const add = async () => {
    if (!predecessor || !successor) {
      setError("Select both a predecessor and a successor.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.tasks.addDependency(projectId, predecessor, successor);
      setPredecessor("");
      setSuccessor("");
      await onRefresh();
      toast("Dependency added. The schedule was recalculated deterministically.", "success");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The dependency could not be added.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (pred: string, succ: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.tasks.removeDependency(projectId, pred, succ);
      await onRefresh();
      toast("Dependency removed.", "success");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The dependency could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Dependencies change the schedule">
        Adding or removing a dependency triggers deterministic rescheduling. Cycles are rejected by the graph validator.
        This does not create a new plan version; use the decision workflow for approved plan changes.
      </Alert>

      {canEdit && (
        <Card>
          <CardHeader title="Add dependency" description="The successor cannot start until the predecessor finishes." />
          <div className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Predecessor" htmlFor="dep-pred">
              <Select id="dep-pred" value={predecessor} onChange={(event) => setPredecessor(event.target.value)}>
                <option value="">Select task</option>
                {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </Select>
            </Field>
            <Field label="Successor" htmlFor="dep-succ">
              <Select id="dep-succ" value={successor} onChange={(event) => setSuccessor(event.target.value)}>
                <option value="">Select task</option>
                {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </Select>
            </Field>
            <Button variant="primary" onClick={() => void add()} loading={busy}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          {error && (
            <div className="border-t border-danger-100 bg-danger-50 px-4 py-2.5 text-xs text-danger-600" role="alert">
              {error}
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Dependency graph" description={`${edges.length} direct relationship${edges.length === 1 ? "" : "s"} in this project.`} />
        {edges.length === 0 ? (
          <EmptyState icon={GitBranch} title="No dependencies" description="Add a dependency or approve a plan that includes predecessor relationships." compact />
        ) : (
          <ul className="divide-y divide-line-faint">
            {edges.map((edge) => (
              <li key={`${edge.predecessor}-${edge.successor}`} className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
                <span className="font-medium text-ink">{taskById.get(edge.predecessor)?.title ?? edge.predecessor}</span>
                <ChevronRight className="h-3.5 w-3.5 text-ink-faint" />
                <span className="font-medium text-ink">{taskById.get(edge.successor)?.title ?? edge.successor}</span>
                <span className="ml-auto flex items-center gap-2">
                  <Badge tone="outline">Finishes to start</Badge>
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => void remove(edge.predecessor, edge.successor)} aria-label="Remove dependency">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function ProjectHistoryView({ projectId }: { projectId: string }) {
  const { data, loading, error, reload } = useAsync<ProjectHistory>(
    () => api.projects.getHistory(projectId),
    [projectId],
  );
  if (loading) return <LoadingBlock label="Loading plan history" />;
  if (error || !data) {
    return (
      <Alert tone="danger" title="History could not load">
        {error ?? "No history was returned."}
        <Button size="sm" className="ml-2" onClick={() => void reload()}>Retry</Button>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="Immutable plan versions" description="Approved decisions create a new version. Earlier versions are never rewritten." />
          <ol className="space-y-0 px-5 py-4">
            {data.versions.map((version, index) => (
              <li key={version.id} className="relative flex gap-3 pb-5 last:pb-0">
                {index < data.versions.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-line" aria-hidden />}
                <span className="relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-[9px] font-bold text-primary-700">
                  {version.versionNumber}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-ink">Plan v{version.versionNumber}</p>
                    {index === 0 && <Badge tone="sage">Current</Badge>}
                    <span className="text-[10px] text-ink-faint">{relativeTime(version.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-ink-muted">{version.changeSummary}</p>
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-ink-faint">
                    <LockKeyhole className="h-3 w-3" />
                    {version.approvedByName ? `Approved by ${version.approvedByName}` : "Created by the plan workflow"} · {formatDate(version.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <CardHeader title="Decision history" description="Every authorized decision and its reason." />
          {data.decisions.length === 0 ? (
            <EmptyState icon={History} title="No decisions yet" description="Approved, rejected and clarified proposals appear here." compact />
          ) : (
            <ul className="max-h-[420px] divide-y divide-line-faint overflow-y-auto">
              {data.decisions.map((decision) => (
                <li key={decision.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={decision.action === "approve" ? "sage" : decision.action === "reject" ? "danger" : "amber"}>
                      {titleCase(decision.action)}
                    </Badge>
                    <span className="text-[10px] text-ink-faint">{relativeTime(decision.timestamp)}</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-ink">{decision.ticketTitle ?? "Decision"}</p>
                  <p className="mt-0.5 text-[11px] leading-5 text-ink-muted">{decision.reason || "No reason recorded."}</p>
                  <p className="mt-0.5 text-[10px] text-ink-faint">{decision.actorName ?? "Unknown actor"}{decision.option ? ` · ${titleCase(decision.option)}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Audit trail" description="Operational task, milestone and collaboration events recorded by the backend." />
        {data.auditEvents.length === 0 ? (
          <EmptyState icon={ShieldAlert} title="No audit events" description="Task edits and project operations are recorded here." compact />
        ) : (
          <ul className="divide-y divide-line-faint">
            {data.auditEvents.map((event) => (
              <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
                <div>
                  <p className="text-xs font-medium text-ink">{event.summary}</p>
                  <p className="mt-0.5 text-[10px] text-ink-faint">
                    {event.actorName ?? "System"} · {event.action} · {event.entityType}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-ink-faint">{relativeTime(event.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function ProjectOverview({
  plan,
  onNavigate,
}: {
  plan: ProjectPlan;
  onNavigate: (tab: string) => void;
}) {
  const { users } = useWorkspace();
  const taskByMilestone = new Map<string, number>();
  for (const task of plan.tasks) {
    if (task.milestoneId) taskByMilestone.set(task.milestoneId, (taskByMilestone.get(task.milestoneId) ?? 0) + 1);
  }
  const done = plan.tasks.filter((task) => task.status === "done").length;
  const blocked = plan.tasks.filter((task) => task.status === "blocked").length;
  const assigneeCount = new Set(users.map((user) => user.id)).size;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Project brief" description="Goal and delivery constraints captured with the approved plan." />
          <div className="space-y-4 p-5">
            <div>
              <p className="label">Goal</p>
              <p className="mt-1 text-sm leading-6 text-ink-soft">{plan.project.goal}</p>
            </div>
            <div>
              <p className="label">Description</p>
              <p className="mt-1 text-sm leading-6 text-ink-muted">{plan.project.description}</p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-line bg-surface-muted p-3">
                <dt className="label">Start date</dt>
                <dd className="mt-1 text-sm text-ink">{formatDate(plan.project.startDate)}</dd>
              </div>
              <div className="rounded-md border border-line bg-surface-muted p-3">
                <dt className="label">Target date</dt>
                <dd className="mt-1 text-sm text-ink">{formatDate(plan.project.targetDate)}</dd>
              </div>
              <div className="rounded-md border border-line bg-surface-muted p-3">
                <dt className="label">Plan version</dt>
                <dd className="mt-1 text-sm text-ink">v{plan.version}</dd>
              </div>
              <div className="rounded-md border border-line bg-surface-muted p-3">
                <dt className="label">Project role</dt>
                <dd className="mt-1 text-sm text-ink">{titleCase(plan.project.role)}</dd>
              </div>
            </dl>
            {plan.constraints.nonNegotiables && (
              <Alert tone="warning" title="Non-negotiable constraint">
                {plan.constraints.nonNegotiables}
              </Alert>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Delivery snapshot" description="Observed from the current plan." />
          <div className="grid grid-cols-2 gap-3 p-5">
            {[
              ["Requirements", plan.requirements.length],
              ["Tasks", plan.tasks.length],
              ["Done", done],
              ["Blocked", blocked],
              ["Milestones", plan.milestones.length],
              ["Members", plan.members.length],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border border-line bg-surface-muted p-3">
                <p className="text-[10px] text-ink-faint">{label}</p>
                <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-line px-5 py-3">
            <Button variant="secondary" className="w-full justify-between" onClick={() => onNavigate("tasks")}>
              Open task board <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      </div>

      {plan.validation && (!plan.validation.valid || plan.validation.warnings.length > 0) && (
        <Alert tone={plan.validation.valid ? "warning" : "danger"} title="Plan validation findings">
          <ul className="list-disc space-y-1 pl-4">
            {plan.validation.errors.map((message) => <li key={message}>{message}</li>)}
            {plan.validation.warnings.map((message) => <li key={message}>{message}</li>)}
          </ul>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Requirements" description="Source requirements and acceptance criteria from plan v{plan.version}." />
          {plan.requirements.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No requirements recorded" description="Requirements are created with the plan draft." compact />
          ) : (
            <ul className="divide-y divide-line-faint">
              {plan.requirements.map((requirement) => (
                <li key={requirement.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-semibold text-ink">{requirement.title}</p>
                    <Badge tone={requirement.status === "done" ? "sage" : "neutral"}>{titleCase(requirement.status)}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-ink-muted">{requirement.description}</p>
                  {requirement.acceptanceCriteria.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {requirement.acceptanceCriteria.slice(0, 4).map((criterion) => (
                        <li key={criterion} className="flex gap-1.5 text-[10px] text-ink-faint"><CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0" />{criterion}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Milestones" description="Approved target dates and release gates." />
          {plan.milestones.length === 0 ? (
            <EmptyState icon={Milestone} title="No milestones" description="This plan has no milestones." compact />
          ) : (
            <ul className="divide-y divide-line-faint">
              {plan.milestones.map((milestone) => (
                <li key={milestone.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-xs font-semibold text-ink">{milestone.title}</p>
                    <p className="mt-0.5 text-[10px] text-ink-faint">
                      {taskByMilestone.get(milestone.id) ?? 0} tasks · Target {formatShortDate(milestone.targetDate)}
                    </p>
                    {milestone.description && <p className="mt-1 text-[11px] leading-5 text-ink-muted">{milestone.description}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {milestone.releaseGate && <Badge tone="outline">Release gate</Badge>}
                    <Badge tone={milestone.status === "done" ? "sage" : "neutral"}>{titleCase(milestone.status)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Assumptions" description="Explicit assumptions preserved from the plan. Treat as inferred." />
          {plan.assumptions.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No assumptions recorded" compact />
          ) : (
            <ul className="space-y-2 p-5">
              {plan.assumptions.map((assumption) => (
                <li key={assumption} className="flex gap-2 text-xs leading-5 text-ink-muted"><Badge tone="amber">Inferred</Badge>{assumption}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Missing information" description="Unknowns must stay visible; they are not filled in by inference." />
          {plan.missingInformation.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No open missing information" compact />
          ) : (
            <ul className="space-y-2 p-5">
              {plan.missingInformation.map((item) => (
                <li key={item} className="flex gap-2 text-xs leading-5 text-ink-muted"><Badge tone="neutral">Unknown</Badge>{item}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Project members" description="Explicit project grants plus workspace-derived access." actions={<UsersRound className="h-4 w-4 text-ink-faint" />} />
        <ul className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
          {plan.members.map((member) => (
            <li key={member.userId} className="rounded-md border border-line bg-surface-muted p-3">
              <p className="text-xs font-semibold text-ink">{member.name}</p>
              <p className="mt-0.5 text-[10px] text-ink-faint">{member.title || "Team member"}</p>
              <Badge tone={member.role === "owner" ? "primary" : "neutral"} className="mt-1.5">{titleCase(member.role)}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
