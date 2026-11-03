import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarRange,
  FolderKanban,
  Inbox,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { hasRole, formatDate, priorityTone } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  ProgressBar,
  Select,
} from "../components/ui";

export function ProjectsPage() {
  const { projects, role, activeWorkspace } = useWorkspace();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    const items = projects.filter(
      (project) =>
        !value ||
        project.name.toLowerCase().includes(value) ||
        project.goal.toLowerCase().includes(value) ||
        project.description.toLowerCase().includes(value),
    );
    return items.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "decisions") return b.pendingDecisionCount - a.pendingDecisionCount;
      if (sort === "target") return (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999");
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [projects, query, sort]);

  return (
    <div>
      <PageHeader
        eyebrow={<><FolderKanban className="h-3.5 w-3.5" /> {activeWorkspace?.name}</>}
        title="Projects"
        description="Every project carries its own plan versions, tasks, tickets and decision history. Access is scoped by workspace and explicit membership."
        actions={
          hasRole(role, "member") ? (
            <Link to="/ai/plan" className="btn-primary">
              <Plus className="h-4 w-4" /> New project
            </Link>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, goal or description…"
            className="pl-8"
            aria-label="Search projects"
          />
        </div>
        <Select value={sort} onChange={(event) => setSort(event.target.value)} className="w-auto" aria-label="Sort projects">
          <option value="updated">Newest first</option>
          <option value="name">Name A–Z</option>
          <option value="decisions">Most pending decisions</option>
          <option value="target">Target date</option>
        </Select>
        <span className="ml-auto font-mono text-[10px] text-ink-faint">{filtered.length} of {projects.length}</span>
      </div>

      {projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create a project from a generated plan. The plan draft is reviewed before any project record is committed."
            action={hasRole(role, "member") ? <Link to="/ai/plan" className="btn-primary"><Sparkles className="h-4 w-4" /> Generate a plan</Link> : undefined}
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState icon={Search} title="No matching projects" description={`No project matches “${query}”.`} action={<Button onClick={() => setQuery("")}>Clear search</Button>} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((project) => {
            const health =
              project.pendingDecisionCount > 0
                ? { label: "Decision needed", tone: "amber" as const }
                : project.openTicketCount > 0
                  ? { label: "Triage open", tone: "primary" as const }
                  : { label: "Healthy", tone: "sage" as const };
            return (
              <Card key={project.id} className="flex flex-col">
                <div className="flex-1 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link to={`/projects/${project.id}`} className="text-base font-semibold text-ink hover:text-primary-700 hover:underline">
                          {project.name}
                        </Link>
                        <Badge tone={health.tone} dot>{health.label}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{project.goal}</p>
                    </div>
                    <Badge tone="outline">Plan v{project.currentPlanVersion}</Badge>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ["Tasks", project.taskCount],
                      ["Tickets", project.openTicketCount],
                      ["Decisions", project.pendingDecisionCount],
                      ["Members", project.memberCount],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md border border-line bg-surface-muted px-2.5 py-2">
                        <p className="text-[9px] uppercase tracking-wide text-ink-faint">{label}</p>
                        <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-ink-faint">
                    <span className="inline-flex items-center gap-1"><CalendarRange className="h-3 w-3" /> {formatDate(project.startDate)} → {formatDate(project.targetDate)}</span>
                    <span>·</span>
                    <span>{project.milestoneCount} milestones</span>
                  </div>
                  {project.nextMilestone && (
                    <div className="mt-2 rounded-md border border-line px-3 py-2">
                      <p className="text-[10px] text-ink-faint">Next milestone</p>
                      <p className="mt-0.5 flex items-center justify-between gap-2 text-xs font-medium text-ink">
                        <span className="truncate">{project.nextMilestone.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-ink-muted">{formatDate(project.nextMilestone.targetDate)}</span>
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-faint">
                    <Badge tone="neutral">{project.role}</Badge>
                    Created {formatDate(project.createdAt)}
                  </span>
                  <div className="flex gap-1.5">
                    <Link to={`/tickets?project=${project.id}`} className="btn-ghost min-h-8 px-2 py-1.5 text-xs">
                      <Inbox className="h-3.5 w-3.5" /> Tickets
                    </Link>
                    <Link to={`/projects/${project.id}`} className="btn-secondary min-h-8 px-2.5 py-1.5 text-xs">
                      Open <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
