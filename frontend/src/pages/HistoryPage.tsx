import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, History, LockKeyhole, ShieldCheck } from "lucide-react";
import type { ProjectHistory } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { formatDate, relativeTime, titleCase } from "../lib/format";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Select,
  StatCard,
} from "../components/ui";
import { ProjectHistoryView } from "./project/ProjectSections";

interface HistoryRow {
  projectId: string;
  projectName: string;
  history: ProjectHistory;
}

export function HistoryPage() {
  const { projects, activeWorkspace } = useWorkspace();
  const [selectedProject, setSelectedProject] = useState("");
  const projectIds = projects.map((project) => project.id).join(",");
  const { data, loading, error, reload } = useAsync<HistoryRow[]>(
    async () => {
      const rows = await Promise.all(
        projects.map(async (project) => ({
          projectId: project.id,
          projectName: project.name,
          history: await api.projects.getHistory(project.id),
        })),
      );
      return rows;
    },
    [projectIds],
  );

  const aggregate = useMemo(() => {
    const decisions = (data ?? [])
      .flatMap((row) =>
        row.history.decisions.map((decision) => ({
          ...decision,
          projectId: row.projectId,
          projectName: row.projectName,
        })),
      )
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const versions = (data ?? []).reduce((sum, row) => sum + row.history.versions.length, 0);
    const approved = decisions.filter((decision) => decision.action === "approve").length;
    const rejected = decisions.filter((decision) => decision.action === "reject").length;
    return { decisions, versions, approved, rejected };
  }, [data]);

  const detailProject = data?.find((row) => row.projectId === selectedProject);

  return (
    <div>
      <PageHeader
        eyebrow={activeWorkspace?.name}
        title="Decision & Plan History"
        description="Immutable plan versions, every authorized decision and the audit trail behind project changes. Earlier plan versions are never rewritten."
        actions={
          <Select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)} className="w-auto max-w-[280px]" aria-label="Select project history">
            <option value="">Choose a project for details</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
        }
      />

      {loading ? (
        <LoadingBlock label="Loading workspace history" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void reload()} />
      ) : projects.length === 0 ? (
        <Card><EmptyState icon={History} title="No plan history" description="Create a project and approve a baseline plan to start the immutable history." /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Plan versions" value={aggregate.versions} hint="Across projects in this workspace" icon={LockKeyhole} />
            <StatCard label="Recorded decisions" value={aggregate.decisions.length} hint="Approvals, rejections and clarifications" icon={ShieldCheck} tone="primary" />
            <StatCard label="Approved changes" value={aggregate.approved} hint="Each approval creates a new immutable version" icon={History} tone="sage" />
            <StatCard label="Rejected proposals" value={aggregate.rejected} hint="No plan mutation" icon={History} tone={aggregate.rejected > 0 ? "amber" : "neutral"} />
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Workspace decision trail" description="Newest decision first. Open a project to inspect its full versions and audit events." />
              {aggregate.decisions.length === 0 ? (
                <EmptyState icon={History} title="No decisions yet" description="Ticket analyses that reach a human decision will appear here." compact />
              ) : (
                <ul className="max-h-[480px] divide-y divide-line-faint overflow-y-auto">
                  {aggregate.decisions.map((decision) => (
                    <li key={decision.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={decision.action === "approve" ? "sage" : decision.action === "reject" ? "danger" : "amber"}>{titleCase(decision.action)}</Badge>
                            {decision.option && <Badge tone="outline">{titleCase(decision.option)}</Badge>}
                            <span className="text-[10px] text-ink-faint">{relativeTime(decision.timestamp)}</span>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-ink">{decision.ticketTitle ?? "Decision"}</p>
                          <p className="mt-0.5 text-[11px] leading-5 text-ink-muted">{decision.reason || "No reason recorded."}</p>
                          <p className="mt-0.5 text-[10px] text-ink-faint">{decision.projectName} · {decision.actorName ?? "Unknown actor"}</p>
                        </div>
                        <Link to={`/projects/${decision.projectId}?tab=history`} className="text-[10px] font-semibold text-primary-600 hover:underline">Open <ArrowRight className="inline h-3 w-3" /></Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Plan version index" description="Every project’s current and historical versions." />
              <ul className="divide-y divide-line-faint">
                {(data ?? []).map((row) => (
                  <li key={row.projectId} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link to={`/projects/${row.projectId}?tab=history`} className="text-xs font-semibold text-ink hover:text-primary-700 hover:underline">{row.projectName}</Link>
                      <Badge tone="outline">{row.history.versions.length} version{row.history.versions.length === 1 ? "" : "s"}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {row.history.versions.map((version, index) => (
                        <span key={version.id} className="inline-flex items-center gap-1 rounded border border-line bg-surface-muted px-1.5 py-0.5 font-mono text-[9px] text-ink-muted" title={version.changeSummary}>
                          v{version.versionNumber}{index === 0 ? " current" : ""} · {formatDate(version.createdAt)}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {detailProject && (
            <div className="mt-7 border-t border-line pt-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-ink">{detailProject.projectName}</h2>
                  <p className="mt-0.5 text-xs text-ink-muted">Immutable plan versions, decisions and audit events for this project.</p>
                </div>
                <Link to={`/projects/${detailProject.projectId}?tab=history`} className="btn-secondary min-h-8 px-2.5 py-1.5 text-xs">Open project <ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
              <ProjectHistoryView projectId={detailProject.projectId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
