import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarRange } from "lucide-react";
import type { BoardTask, ProjectPlan } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Card, EmptyState, ErrorBlock, LoadingBlock, PageHeader, Select } from "../components/ui";
import { RoadmapView } from "./project/ProjectSections";

export function RoadmapPage() {
  const { projects, activeWorkspace } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") ?? projects[0]?.id ?? "";

  const { data, loading, error, reload } = useAsync<{ plan: ProjectPlan; tasks: BoardTask[] } | null>(
    async () => {
      if (!projectId) return null;
      const [plan, taskResult] = await Promise.all([api.projects.getPlan(projectId), api.tasks.list(projectId)]);
      return { plan, tasks: taskResult.tasks };
    },
    [projectId],
  );

  const selected = useMemo(() => projects.find((project) => project.id === projectId), [projects, projectId]);

  if (projects.length === 0) {
    return (
      <div>
        <PageHeader title="Roadmaps & Milestones" description="Timeline and milestone delivery for the active workspace." />
        <Card><EmptyState icon={CalendarRange} title="No projects" description="A roadmap is generated from a project plan. Create a project first." /></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={activeWorkspace?.name}
        title="Roadmaps & Milestones"
        description="Planned dates, dependencies and release gates from the current approved plan. A target breach is shown when planned work exceeds a milestone target."
        actions={
          <Select
            value={projectId}
            onChange={(event) => setParams({ project: event.target.value }, { replace: true })}
            aria-label="Select project"
            className="w-auto max-w-[280px]"
          >
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
        }
      />

      {loading ? (
        <LoadingBlock label="Loading roadmap" />
      ) : error || !data ? (
        <ErrorBlock message={error ?? "No roadmap was returned."} onRetry={() => void reload()} />
      ) : (
        <>
          {selected && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <Link to={`/projects/${selected.id}`} className="font-semibold text-primary-600 hover:underline">{selected.name}</Link>
              <span>·</span>
              <span>{selected.taskCount} tasks</span>
              <span>·</span>
              <span>{selected.milestoneCount} milestones</span>
              <span>·</span>
              <span>Plan v{selected.currentPlanVersion}</span>
            </div>
          )}
          <RoadmapView projectId={data.plan.project.id} plan={data.plan} tasks={data.tasks} />
        </>
      )}
    </div>
  );
}
