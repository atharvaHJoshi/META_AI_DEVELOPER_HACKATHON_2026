import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileClock,
  Filter,
  KeyRound,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { api, type WorkspaceAuditEvent } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { formatDateTime, relativeTime, titleCase } from "../lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  StatCard,
  Table,
  Td,
  Th,
} from "../components/ui";

interface ProjectAuditRow {
  id: string;
  projectId: string;
  projectName: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string | null;
  timestamp: string;
  summary: string;
}

export function AuditPage() {
  const { activeWorkspace, projects } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";
  const [tab, setTab] = useState<"security" | "project">("security");
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("all");

  const security = useAsync<{ events: WorkspaceAuditEvent[] }>(
    () => api.workspaces.audit(workspaceId),
    [workspaceId],
  );
  const projectIds = projects.map((project) => project.id).join(",");
  const projectAudit = useAsync<ProjectAuditRow[]>(
    async () => {
      const rows = await Promise.all(
        projects.map(async (project) => {
          const history = await api.projects.getHistory(project.id);
          return history.auditEvents.map((event) => ({ ...event, projectId: project.id, projectName: project.name }));
        }),
      );
      return rows.flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    },
    [projectIds],
  );

  const securityEvents = security.data?.events ?? [];
  const projectEvents = projectAudit.data ?? [];

  const filteredSecurity = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return securityEvents.filter(
      (event) =>
        (outcome === "all" || event.outcome === outcome) &&
        (!needle ||
          `${event.action} ${event.actorName ?? ""} ${event.outcome} ${JSON.stringify(event.metadata)}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [securityEvents, outcome, search]);

  const filteredProject = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return projectEvents.filter(
      (event) =>
        !needle ||
        `${event.action} ${event.actorName ?? ""} ${event.projectName} ${event.entityType} ${event.summary}`
          .toLowerCase()
          .includes(needle),
    );
  }, [projectEvents, search]);

  const downloadCsv = () => {
    const rows =
      tab === "security"
        ? [
            ["timestamp", "action", "outcome", "actor", "metadata"],
            ...filteredSecurity.map((event) => [
              event.createdAt,
              event.action,
              event.outcome,
              event.actorName ?? "",
              JSON.stringify(event.metadata),
            ]),
          ]
        : [
            ["timestamp", "project", "action", "entityType", "entityId", "actor", "summary"],
            ...filteredProject.map((event) => [
              event.timestamp,
              event.projectName,
              event.action,
              event.entityType,
              event.entityId,
              event.actorName ?? "",
              event.summary,
            ]),
          ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `miraiwerk-${tab}-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        eyebrow={`${activeWorkspace?.name ?? "Workspace"} · administration`}
        title="Audit Logs"
        description="Access and security events for this workspace, plus the project plan audit trail. Events are append-only; deleting a plan version is not supported."
        actions={
          <>
            <Button variant="secondary" onClick={downloadCsv} disabled={tab === "security" ? filteredSecurity.length === 0 : filteredProject.length === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="ghost" onClick={() => { void security.reload(); void projectAudit.reload(); }}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </>
        }
        meta={
          <>
            <Badge tone="outline">Last {securityEvents.length} security events</Badge>
            <span>{projectEvents.length} project audit events</span>
            <span>· Newest first</span>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Security events" value={securityEvents.length} hint="Workspace-scoped, up to 100 recent" icon={ShieldCheck} tone="primary" />
        <StatCard label="Project events" value={projectEvents.length} hint="Across accessible projects" icon={FileClock} tone="neutral" />
        <StatCard label="Denied attempts" value={securityEvents.filter((event) => event.outcome !== "success").length} hint="Rejected actions are logged, not hidden" icon={ShieldAlert} tone={securityEvents.some((event) => event.outcome !== "success") ? "danger" : "sage"} />
        <StatCard label="Actors recorded" value={new Set([...securityEvents.map((event) => event.actorName), ...projectEvents.map((event) => event.actorName)].filter(Boolean)).size} hint="Named users in the returned events" icon={KeyRound} tone="neutral" />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <div className="flex gap-1">
          {[
            ["security", "Security & access"],
            ["project", "Project activity"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value as "security" | "project")}
              className={`border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${tab === value ? "border-primary-500 text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search audit events…" className="w-56 pl-8" aria-label="Search audit events" />
          </div>
          {tab === "security" && (
            <Select value={outcome} onChange={(event) => setOutcome(event.target.value)} className="w-auto" aria-label="Filter by outcome">
              <option value="all">All outcomes</option>
              <option value="success">Success</option>
              <option value="denied">Denied</option>
              <option value="failure">Failure</option>
            </Select>
          )}
        </div>
      </div>

      {tab === "security" ? (
        <Card className="mt-5">
          <CardHeader title="Security and access events" description="Role changes, member changes, workspace creation and other security-relevant actions." />
          {security.loading ? (
            <LoadingBlock label="Loading security audit" />
          ) : security.error ? (
            <div className="p-4"><ErrorBlock message={security.error} onRetry={() => void security.reload()} /></div>
          ) : filteredSecurity.length === 0 ? (
            <EmptyState icon={ShieldCheck} title={securityEvents.length === 0 ? "No security events" : "No matches"} description={securityEvents.length === 0 ? "Administrative actions will appear here as they occur." : "Clear the search or outcome filter."} compact />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead><tr><Th>When</Th><Th>Action</Th><Th>Outcome</Th><Th>Actor</Th><Th>Details</Th></tr></thead>
                <tbody>
                  {filteredSecurity.map((event) => (
                    <tr key={event.id}>
                      <Td><span className="whitespace-nowrap font-mono text-[10px] text-ink-muted" title={formatDateTime(event.createdAt)}>{relativeTime(event.createdAt)}</span></Td>
                      <Td><span className="text-xs font-semibold text-ink">{titleCase(event.action)}</span></Td>
                      <Td>
                        <Badge tone={event.outcome === "success" ? "sage" : "danger"} dot>{titleCase(event.outcome)}</Badge>
                      </Td>
                      <Td><span className="text-xs text-ink-muted">{event.actorName ?? "System"}</span></Td>
                      <Td>
                        <details className="group">
                          <summary className="cursor-pointer text-[10px] font-semibold text-primary-600 hover:underline">View metadata</summary>
                          <pre className="mt-1.5 max-w-xl overflow-x-auto rounded border border-line bg-surface-muted p-2 font-mono text-[9px] leading-4 text-ink-muted">{JSON.stringify(event.metadata, null, 2)}</pre>
                        </details>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-line px-5 py-3 text-[10px] text-ink-faint">
            The workspace audit endpoint returns at most 100 recent security events. It does not sketch older events into an aggregate; no retention claim is made beyond what is returned.
          </div>
        </Card>
      ) : (
        <Card className="mt-5">
          <CardHeader title="Project plan audit trail" description="Recorded mutations and decisions from project history. Plan versions themselves remain immutable." />
          {projectAudit.loading ? (
            <LoadingBlock label="Loading project audit events" />
          ) : projectAudit.error ? (
            <div className="p-4"><ErrorBlock message={projectAudit.error} onRetry={() => void projectAudit.reload()} /></div>
          ) : filteredProject.length === 0 ? (
            <EmptyState icon={FileClock} title={projectEvents.length === 0 ? "No project audit events" : "No matches"} description={projectEvents.length === 0 ? "Create a project, edit a task or approve a plan change to populate the project audit trail." : "Clear the search."} compact />
          ) : (
            <Table className="min-w-[820px]">
              <thead><tr><Th>When</Th><Th>Project</Th><Th>Action</Th><Th>Entity</Th><Th>Actor</Th><Th>Summary</Th></tr></thead>
              <tbody>
                {filteredProject.map((event) => (
                  <tr key={`${event.projectId}-${event.id}`}>
                    <Td><span className="whitespace-nowrap font-mono text-[10px] text-ink-muted" title={formatDateTime(event.timestamp)}>{relativeTime(event.timestamp)}</span></Td>
                    <Td><span className="text-xs font-medium text-ink">{event.projectName}</span></Td>
                    <Td><span className="text-xs font-semibold text-ink">{titleCase(event.action)}</span></Td>
                    <Td>
                      <Badge tone="outline">{titleCase(event.entityType)}</Badge>
                      <p className="mt-1 font-mono text-[9px] text-ink-faint">{event.entityId}</p>
                    </Td>
                    <Td><span className="text-xs text-ink-muted">{event.actorName ?? "System"}</span></Td>
                    <Td><span className="max-w-xs text-[11px] leading-5 text-ink-muted">{event.summary}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="border-t border-line px-5 py-3 text-[10px] text-ink-faint">
            Project audit events are loaded from each accessible project’s history endpoint. If a project becomes inaccessible, its audit events are not returned.
          </div>
        </Card>
      )}

      <div className="mt-5">
        <Alert tone="info" title="Audit boundaries">
          Audit visibility requires owner, admin or manager access. Exporting only includes the rows currently returned and filtered by this page; it does not claim to be a complete legal archive.
        </Alert>
      </div>
    </div>
  );
}
