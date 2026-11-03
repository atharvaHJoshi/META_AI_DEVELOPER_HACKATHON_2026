import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ListChecks, Plus } from "lucide-react";
import type { BoardTask, ProjectPlan } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { hasRole } from "../lib/format";
import { Card, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Select } from "../components/ui";
import { TaskBoard } from "./project/TaskBoard";

interface TaskPageData {
  plan: ProjectPlan;
  tasks: BoardTask[];
}

export function TasksPage() {
  const { projects, role } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") ?? projects[0]?.id ?? "";
  const focusTaskId = params.get("task");

  const data = useAsync<TaskPageData | null>(
    async () => {
      if (!projectId) return null;
      const [plan, taskResult] = await Promise.all([
        api.projects.getPlan(projectId),
        api.tasks.list(projectId),
      ]);
      return { plan, tasks: taskResult.tasks };
    },
    [projectId],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );

  const setProject = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("project", id);
    next.delete("task");
    setParams(next, { replace: true });
  };

  if (projects.length === 0) {
    return (
      <div>
        <PageHeader title="Tasks & Sprints" description="Operational task management across the active workspace." />
        <Card>
          <EmptyState
            icon={ListChecks}
            title="No project to plan work in"
            description="Create a project first. Tasks can then be managed as a board or list."
            action={hasRole(role, "member") ? <Link to="/ai/plan" className="btn-primary"><Plus className="h-4 w-4" /> Generate a plan</Link> : undefined}
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace delivery"
        title="Tasks & Sprints"
        description="Move work through a permission-aware Kanban board. Status changes and schedules are recorded in project audit history; plan versions remain immutable."
        actions={
          <Select value={projectId} onChange={(event) => setProject(event.target.value)} aria-label="Select project" className="w-auto max-w-[280px]">
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
        }
      />

      {data.loading ? (
        <LoadingBlock label="Loading tasks" />
      ) : data.error || !data.data ? (
        <ErrorBlock message={data.error ?? "No tasks were returned."} onRetry={() => void data.reload()} />
      ) : (
        <TaskBoard
          projectId={data.data.plan.project.id}
          tasks={data.data.tasks}
          milestones={data.data.plan.milestones}
          canEdit={hasRole(data.data.plan.project.role, "member")}
          onRefresh={data.reload}
          focusTaskId={data.data.tasks.some((task) => task.id === focusTaskId) ? focusTaskId : null}
        />
      )}

      {selectedProject && (
        <p className="mt-4 text-[10px] text-ink-faint">
          Project <Link to={`/projects/${selectedProject.id}`} className="font-semibold text-primary-600 hover:underline">{selectedProject.name}</Link> · target {selectedProject.targetDate ?? "not set"}
        </p>
      )}
    </div>
  );
}
