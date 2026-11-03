import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CircleHelp,
  Inbox,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import type { TicketListItem } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { formatDate, hasRole, relativeTime, titleCase } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeader,
  PriorityBadge,
  Select,
  StatusBadge,
} from "../components/ui";

type FilterKey = "all" | "pending" | "clarify" | "failed" | "decided";

interface TicketRow extends TicketListItem {
  projectName: string;
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All tickets" },
  { key: "pending", label: "Awaiting decision" },
  { key: "clarify", label: "Needs information" },
  { key: "failed", label: "Analysis failed" },
  { key: "decided", label: "Decided" },
];

function matches(ticket: TicketRow, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return ticket.latestDecisionStatus === "pending";
  if (filter === "clarify") return ticket.status === "needs_clarification";
  if (filter === "failed") return ticket.status === "analysis_failed";
  return ticket.latestDecisionStatus !== null && ticket.latestDecisionStatus !== "pending";
}

function recommendationLabel(value: string | null): string {
  if (!value) return "No recommendation";
  return `Recommends ${value === "split" ? "split" : value === "clarify" ? "clarification" : value}`;
}

export function TicketsPage() {
  const { projects, role, activeWorkspace } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const projectFilter = params.get("project") ?? "all";
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");

  const projectIds = projects.map((project) => project.id).join(",");
  const { data, loading, error, reload } = useAsync<TicketRow[]>(
    async () => {
      const groups = await Promise.all(
        projects.map(async (project) => {
          const result = await api.tickets.list(project.id);
          return result.tickets.map((ticket) => ({ ...ticket, projectName: project.name }));
        }),
      );
      return groups.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    [projectIds],
  );

  const tickets = useMemo(
    () =>
      (data ?? []).filter((ticket) => projectFilter === "all" || ticket.projectId === projectFilter),
    [data, projectFilter],
  );

  const stats = useMemo(
    () => ({
      total: tickets.length,
      pending: tickets.filter((ticket) => ticket.latestDecisionStatus === "pending").length,
      clarify: tickets.filter((ticket) => ticket.status === "needs_clarification").length,
      failed: tickets.filter((ticket) => ticket.status === "analysis_failed").length,
      decided: tickets.filter(
        (ticket) => ticket.latestDecisionStatus !== null && ticket.latestDecisionStatus !== "pending",
      ).length,
    }),
    [tickets],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tickets
      .filter((ticket) => matches(ticket, filter))
      .filter(
        (ticket) =>
          !needle ||
          `${ticket.title} ${ticket.ticketType ?? ""} ${ticket.latestRecommendation ?? ""} ${ticket.projectName}`
            .toLowerCase()
            .includes(needle),
      );
  }, [tickets, filter, search]);

  const setProjectFilter = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("project");
    else next.set("project", value);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        eyebrow={activeWorkspace?.name}
        title="Ticket Inbox"
        description="Intake from incidents, requests, meetings and customer reports. Analysis creates a proposal; nothing changes in the plan until an authorized decision is made."
        actions={
          hasRole(role, "member") ? (
            <Link to={`/tickets/new${projectFilter !== "all" ? `?project=${projectFilter}` : ""}`} className="btn-primary">
              <Plus className="h-4 w-4" /> New ticket
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Tickets", value: stats.total, tone: "text-ink" },
          { label: "Awaiting decision", value: stats.pending, tone: "text-warning-600" },
          { label: "Needs information", value: stats.clarify, tone: "text-primary-700" },
          { label: "Decided", value: stats.decided, tone: "text-sage-700" },
        ].map((metric) => (
          <Card key={metric.label} className="p-4">
            <p className="text-xs font-medium text-ink-muted">{metric.label}</p>
            <p className={`mt-1.5 text-2xl font-semibold tracking-tight ${metric.tone}`}>{metric.value}</p>
          </Card>
        ))}
      </div>

      {stats.failed > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-danger-100 bg-danger-50 px-4 py-2.5 text-xs text-danger-600">
          <AlertCircle className="h-4 w-4" />
          {stats.failed} ticket{stats.failed === 1 ? "" : "s"} failed analysis. Open the ticket and retry; the failure is not hidden as a recommendation.
        </div>
      )}

      <Card className="mt-5">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tickets…"
              className="pl-8"
              aria-label="Search tickets"
            />
          </div>
          <Select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="w-auto max-w-[240px]"
            aria-label="Filter by project"
          >
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </Select>
          <div className="ml-auto flex flex-wrap gap-1">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  filter === item.key
                    ? "bg-primary-50 text-primary-700"
                    : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingBlock label="Loading ticket inbox" />
        ) : error ? (
          <div className="p-4"><ErrorBlock message={error} onRetry={() => void reload()} /></div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={tickets.length === 0 ? "No tickets yet" : "No tickets match the filters"}
            description={
              tickets.length === 0
                ? "Create a ticket to analyse a change against the approved plan."
                : "Clear the search or select another filter."
            }
            action={
              tickets.length === 0 && hasRole(role, "member") ? (
                <Link to="/tickets/new" className="btn-primary"><Plus className="h-4 w-4" /> New ticket</Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {visible.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  to={`/tickets/${ticket.id}`}
                  className="group grid gap-3 px-4 py-3.5 transition-colors hover:bg-surface-muted sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        ticket.status === "analysis_failed"
                          ? "bg-danger-500"
                          : ticket.latestRecommendation === "accept"
                            ? "bg-sage-500"
                            : ticket.latestRecommendation === "split"
                              ? "bg-primary-500"
                              : ticket.latestRecommendation === "clarify"
                                ? "bg-warning-500"
                                : "bg-ink-faint"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-ink group-hover:text-primary-700">{ticket.title}</p>
                        {ticket.ticketType && <span className="font-mono text-[9px] uppercase tracking-wide text-ink-faint">{titleCase(ticket.ticketType)}</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-ink-faint">
                        <span>{ticket.projectName}</span>
                        <span>·</span>
                        <span>{recommendationLabel(ticket.latestRecommendation)}</span>
                        <span>·</span>
                        <span>{relativeTime(ticket.createdAt)}</span>
                        {ticket.missingEvidenceCount > 0 && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 text-warning-600"><CircleHelp className="h-3 w-3" /> {ticket.missingEvidenceCount} missing evidence</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {ticket.latestRecommendation && <Badge tone={ticket.latestRecommendation === "accept" ? "sage" : ticket.latestRecommendation === "clarify" ? "amber" : "primary"}>{titleCase(ticket.latestRecommendation)}</Badge>}
                    <PriorityBadge priority={ticket.latestPriority} />
                    <StatusBadge status={ticket.latestDecisionStatus ?? ticket.status} />
                    <ArrowRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[10px] text-ink-faint">
          <span>{visible.length} shown · {tickets.length} in scope</span>
          <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3" /> AI analysis is labelled; proposals never mutate the plan.</span>
        </div>
      </Card>
    </div>
  );
}
