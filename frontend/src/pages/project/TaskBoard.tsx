import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Link2,
  ListFilter,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import type { BoardTask } from "@miraiwerk/schemas";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useToast } from "../../context/ToastContext";
import { api, ApiError } from "../../lib/api";
import { cn, formatShortDate, priorityTone, titleCase } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PriorityBadge,
  Select,
  Textarea,
} from "../../components/ui";

const COLUMNS: Array<{ status: BoardTask["status"]; label: string; hint: string; icon: typeof Circle }> = [
  { status: "planned", label: "Planned", hint: "Not started", icon: Circle },
  { status: "in_progress", label: "In progress", hint: "Active work", icon: ChevronRight },
  { status: "blocked", label: "Blocked", hint: "Needs a decision", icon: AlertOctagon },
  { status: "done", label: "Done", hint: "Delivered", icon: CheckCircle2 },
];

const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;

interface TaskFormState {
  title: string;
  description: string;
  status: BoardTask["status"];
  priority: BoardTask["priority"];
  estimateDays: string;
  milestoneId: string;
  assigneeId: string;
  labels: string;
  plannedStart: string;
  plannedFinish: string;
}

function toForm(task?: BoardTask | null): TaskFormState {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    status: task?.status ?? "planned",
    priority: task?.priority ?? "P2",
    estimateDays: String(task?.estimateDays ?? 1),
    milestoneId: task?.milestoneId ?? "",
    assigneeId: task?.assigneeId ?? "",
    labels: (task?.labels ?? []).join(", "),
    plannedStart: task?.plannedStart ?? "",
    plannedFinish: task?.plannedFinish ?? "",
  };
}

export function TaskBoard({
  projectId,
  tasks,
  milestones,
  canEdit,
  onRefresh,
  focusTaskId,
}: {
  projectId: string;
  tasks: BoardTask[];
  milestones: Array<{ id: string; title: string }>;
  canEdit: boolean;
  onRefresh: () => Promise<void>;
  focusTaskId?: string | null;
}) {
  const { users } = useWorkspace();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<string>("all");
  const [assignee, setAssignee] = useState<string>("all");
  const [milestoneFilter, setMilestoneFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<BoardTask | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!focusTaskId) return;
    const task = tasks.find((item) => item.id === focusTaskId);
    if (task) setEditing(task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId, tasks.length]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (value && !`${task.title} ${task.description} ${task.labels.join(" ")}`.toLowerCase().includes(value)) return false;
      if (priority !== "all" && task.priority !== priority) return false;
      if (assignee === "unassigned" && task.assigneeId) return false;
      if (assignee !== "all" && assignee !== "unassigned" && task.assigneeId !== assignee) return false;
      if (milestoneFilter !== "all" && task.milestoneId !== milestoneFilter) return false;
      return true;
    });
  }, [tasks, query, priority, assignee, milestoneFilter]);

  const byStatus = useMemo(() => {
    const map = new Map<BoardTask["status"], BoardTask[]>();
    for (const column of COLUMNS) map.set(column.status, []);
    for (const task of filtered) map.get(task.status)?.push(task);
    return map;
  }, [filtered]);

  const changeStatus = async (task: BoardTask, status: BoardTask["status"]) => {
    if (status === task.status) return;
    try {
      await api.tasks.update(task.id, { status });
      await onRefresh();
      toast(`“${task.title}” moved to ${titleCase(status)}.`, "success");
    } catch (cause) {
      toast(cause instanceof ApiError ? cause.message : "The task status could not be changed.", "error");
    }
  };

  const saveTask = async (form: TaskFormState, task: BoardTask | null) => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description,
        status: form.status,
        priority: form.priority,
        estimateDays: Number(form.estimateDays) || 1,
        milestoneId: form.milestoneId || null,
        assigneeId: form.assigneeId || null,
        labels: form.labels.split(",").map((label) => label.trim()).filter(Boolean),
        plannedStart: form.plannedStart || null,
        plannedFinish: form.plannedFinish || null,
      };
      if (task) await api.tasks.update(task.id, payload);
      else await api.tasks.create(projectId, payload);
      await onRefresh();
      setEditing(null);
      setCreating(false);
      toast(task ? "Task updated." : "Task created.", "success");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The task could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter tasks by title or label…"
            className="pl-8"
            aria-label="Filter tasks"
          />
        </div>
        <Button variant="secondary" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}>
          <ListFilter className="h-3.5 w-3.5" /> Filters
        </Button>
        {canEdit && (
          <Button variant="primary" onClick={() => { setError(null); setCreating(true); }}>
            <Plus className="h-3.5 w-3.5" /> New task
          </Button>
        )}
      </div>

      {showFilters && (
        <div className="mb-4 grid gap-3 rounded-md border border-line bg-surface-muted p-3 sm:grid-cols-3">
          <Field label="Priority" htmlFor="filter-priority">
            <Select id="filter-priority" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="all">All priorities</option>
              {PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </Field>
          <Field label="Assignee" htmlFor="filter-assignee">
            <Select id="filter-assignee" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              <option value="all">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </Select>
          </Field>
          <Field label="Milestone" htmlFor="filter-milestone">
            <Select id="filter-milestone" value={milestoneFilter} onChange={(event) => setMilestoneFilter(event.target.value)}>
              <option value="all">All milestones</option>
              {milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
            </Select>
          </Field>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-4">
        {COLUMNS.map((column) => {
          const items = byStatus.get(column.status) ?? [];
          const Icon = column.icon;
          return (
            <section key={column.status} aria-labelledby={`column-${column.status}`} className="rounded-lg border border-line bg-surface-muted/60">
              <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <Icon className={cn("h-3.5 w-3.5", column.status === "blocked" ? "text-danger-500" : column.status === "done" ? "text-sage-500" : "text-ink-faint")} />
                  <h3 id={`column-${column.status}`} className="text-xs font-semibold text-ink">{column.label}</h3>
                  <span className="rounded-full bg-surface px-1.5 py-0.5 font-mono text-[9px] text-ink-faint">{items.length}</span>
                </div>
                <span className="text-[10px] text-ink-faint">{column.hint}</span>
              </header>
              <div className="min-h-[140px] space-y-2 p-2">
                {items.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[11px] text-ink-faint">No tasks</p>
                ) : (
                  items.map((task) => (
                    <article key={task.id} className="rounded-md border border-line bg-surface p-3 shadow-card">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => { setError(null); setEditing(task); }}
                          className="text-left text-xs font-semibold leading-5 text-ink hover:text-primary-700 hover:underline"
                        >
                          {task.title}
                        </button>
                        <PriorityBadge priority={task.priority} />
                      </div>
                      {task.description && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink-muted">{task.description}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {task.milestoneTitle && <Badge tone="outline">{task.milestoneTitle}</Badge>}
                        {task.labels.map((label) => (
                          <Badge key={label} tone="neutral">{label}</Badge>
                        ))}
                        {task.dependencyIds.length > 0 && (
                          <Badge tone="info"><Link2 className="h-2.5 w-2.5" /> {task.dependencyIds.length}</Badge>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line-faint pt-2 text-[10px] text-ink-faint">
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {task.plannedFinish ? formatShortDate(task.plannedFinish) : "No date"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="h-3 w-3" />
                          {task.assigneeName ?? "Unassigned"}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-ink-faint">{task.estimateDays}d</span>
                        <select
                          aria-label={`Move ${task.title}`}
                          value={task.status}
                          disabled={!canEdit}
                          onChange={(event) => void changeStatus(task, event.target.value as BoardTask["status"])}
                          className="rounded border border-line bg-surface px-1.5 py-1 text-[10px] text-ink-muted disabled:opacity-50"
                        >
                          {COLUMNS.map((option) => <option key={option.status} value={option.status}>{option.label}</option>)}
                        </select>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      {filtered.length === 0 && tasks.length > 0 && (
        <div className="mt-4 rounded-md border border-dashed border-line-strong bg-surface px-4 py-6 text-center text-xs text-ink-muted">
          No tasks match the current filters. Clear filters to see {tasks.length} tasks.
          <button
            type="button"
            className="ml-1 font-semibold text-primary-600 hover:underline"
            onClick={() => { setQuery(""); setPriority("all"); setAssignee("all"); setMilestoneFilter("all"); }}
          >
            Clear filters
          </button>
        </div>
      )}

      {tasks.length === 0 && (
        <div className="mt-4">
          <EmptyState
            icon={Circle}
            title="No tasks in this project"
            description="Tasks normally arrive with an approved plan. You can also add an operational task directly."
            action={canEdit ? <Button variant="primary" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> Add task</Button> : undefined}
          />
        </div>
      )}

      <TaskDialog
        open={creating || editing !== null}
        task={editing}
        milestones={milestones}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSave={saveTask}
        saving={saving}
        error={error}
      />
    </div>
  );
}

function TaskDialog({
  open,
  task,
  milestones,
  onClose,
  onSave,
  saving,
  error,
}: {
  open: boolean;
  task: BoardTask | null;
  milestones: Array<{ id: string; title: string }>;
  onClose: () => void;
  onSave: (form: TaskFormState, task: BoardTask | null) => Promise<void>;
  saving: boolean;
  error: string | null;
}) {
  const { users } = useWorkspace();
  const [form, setForm] = useState<TaskFormState>(toForm(task));

  useEffect(() => {
    setForm(toForm(task));
  }, [task?.id, open]);

  return (
    <Modal
      open={open}
      onOpenChange={(value) => { if (!value) onClose(); }}
      title={task ? "Task details" : "New task"}
      description={task ? "Changes are recorded in project audit history. Plan versioning remains separate." : "Operational task added directly to the current project."}
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            onClick={() => void onSave(form, task)}
          >
            {task ? "Save changes" : "Create task"}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void onSave(form, task); }}>
        {error && <div role="alert" className="rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-xs text-danger-600">{error}</div>}
        <Field label="Title" htmlFor="task-title" required>
          <Input id="task-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
        </Field>
        <Field label="Description" htmlFor="task-description">
          <Textarea id="task-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Status" htmlFor="task-status">
            <Select id="task-status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as BoardTask["status"] })}>
              {COLUMNS.map((column) => <option key={column.status} value={column.status}>{column.label}</option>)}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="task-priority">
            <Select id="task-priority" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as BoardTask["priority"] })}>
              {PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </Field>
          <Field label="Estimate (days)" htmlFor="task-estimate">
            <Input id="task-estimate" type="number" min="0.5" max="60" step="0.5" value={form.estimateDays} onChange={(event) => setForm({ ...form, estimateDays: event.target.value })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Assignee" htmlFor="task-assignee">
            <Select id="task-assignee" value={form.assigneeId} onChange={(event) => setForm({ ...form, assigneeId: event.target.value })}>
              <option value="">Unassigned</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </Select>
          </Field>
          <Field label="Milestone" htmlFor="task-milestone">
            <Select id="task-milestone" value={form.milestoneId} onChange={(event) => setForm({ ...form, milestoneId: event.target.value })}>
              <option value="">No milestone</option>
              {milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Planned start" htmlFor="task-start" hint="Changes here are operational, not a plan version.">
            <Input id="task-start" type="date" value={form.plannedStart} onChange={(event) => setForm({ ...form, plannedStart: event.target.value })} />
          </Field>
          <Field label="Planned finish" htmlFor="task-finish">
            <Input id="task-finish" type="date" value={form.plannedFinish} onChange={(event) => setForm({ ...form, plannedFinish: event.target.value })} />
          </Field>
        </div>
        <Field label="Labels" htmlFor="task-labels" hint="Comma-separated. Shown on the board and useful for filtering.">
          <Input id="task-labels" value={form.labels} onChange={(event) => setForm({ ...form, labels: event.target.value })} placeholder="payments, release-gate" />
        </Field>
        {task && task.dependencyIds.length > 0 && (
          <div className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-ink-muted">
            Predecessors: {task.dependencyIds.join(", ")}. Dependencies are managed from the Dependencies tab.
          </div>
        )}
      </form>
    </Modal>
  );
}
