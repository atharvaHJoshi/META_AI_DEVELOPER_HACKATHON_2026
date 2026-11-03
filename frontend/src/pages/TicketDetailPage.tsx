import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  FileSearch,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import type { TicketDetail } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { formatDateTime, hasRole, relativeTime, titleCase } from "../lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EvidenceBadge,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  PriorityBadge,
  StatusBadge,
} from "../components/ui";

export function TicketDetailPage() {
  const { ticketId = "" } = useParams();
  const { projects, role } = useWorkspace();
  const { toast } = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync<TicketDetail>(
    () => api.tickets.get(ticketId),
    [ticketId],
  );

  if (loading) {
    return (
      <div>
        <PageHeader title="Ticket detail" description="Loading ticket, proposal and audit history…" />
        <LoadingBlock label="Loading ticket" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader eyebrow={<Link to="/tickets" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> Ticket inbox</Link>} title="Ticket unavailable" />
        <ErrorBlock message={error ?? "The ticket could not be loaded."} onRetry={() => void reload()} />
      </div>
    );
  }

  const { ticket, proposal, links, audits } = data;
  const project = projects.find((candidate) => candidate.id === ticket.projectId);
  const canAnalyze = hasRole(role, "member");

  const analyze = async () => {
    setAnalyzing(true);
    setActionError(null);
    try {
      await api.tickets.analyze(ticket.id);
      await reload();
      toast("Analysis completed. Review the updated proposal in RippleMap.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Link to="/tickets" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> Ticket inbox</Link>
            <span className="text-line-strong">/</span>
            <span>{project?.name ?? "Project"}</span>
            <span className="text-line-strong">·</span>
            <span className="font-mono">{ticket.id}</span>
          </>
        }
        title={ticket.title}
        description={`${titleCase(ticket.ticketType ?? "unclassified")} · ${ticket.source} · reported by ${ticket.reporter || "unknown"}`}
        actions={
          <>
            {canAnalyze && (
              <Button variant="secondary" onClick={() => void analyze()} loading={analyzing}>
                <RefreshCw className="h-4 w-4" /> {proposal ? "Re-analyse" : "Analyse ticket"}
              </Button>
            )}
            {proposal && (
              <Link to={`/ripplemap/${proposal.id}`} className="btn-primary">
                <GitCompareArrows className="h-4 w-4" /> Open RippleMap
              </Link>
            )}
          </>
        }
        meta={
          <>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={proposal?.classification.priority} />
            <Badge tone="neutral">{titleCase(ticket.severityReported)} severity reported</Badge>
            <span>Created {formatDateTime(ticket.createdAt)}</span>
            {ticket.analyzedAt && <span>· Analysed {relativeTime(ticket.analyzedAt)}</span>}
          </>
        }
      />

      {actionError && <div className="mb-4"><Alert tone="danger" title="Action failed">{actionError}</Alert></div>}

      {ticket.status === "analysis_failed" && (
        <div className="mb-4">
          <Alert
            tone="danger"
            title="Analysis failed for this ticket"
            action={canAnalyze ? <Button size="sm" onClick={() => void analyze()} loading={analyzing}>Retry analysis</Button> : undefined}
          >
            The failure is recorded explicitly. No recommendation or plan change was produced.
          </Alert>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Ticket signal" description="What was reported, with no model rewrite." />
            <div className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Affected component", ticket.affectedComponent || "Unknown"],
                  ["Environment", ticket.environment || "Unknown"],
                  ["Source", ticket.source],
                  ["Reporter", ticket.reporter || "Unknown"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-line bg-surface-muted p-3">
                    <p className="label">{label}</p>
                    <p className="mt-1 text-xs text-ink">{value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="label mb-1">Description</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-ink-soft">{ticket.description}</p>
              </div>
              <div>
                <p className="label mb-1">Reported impact</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-ink-soft">{ticket.reportedImpact || "Not provided."}</p>
              </div>
              <div>
                <p className="label mb-1">Evidence supplied</p>
                <div className="rounded-md border border-line bg-surface-muted p-3">
                  <p className="whitespace-pre-wrap text-xs leading-5 text-ink-soft">{ticket.evidence || "No evidence was supplied with the ticket."}</p>
                </div>
              </div>
            </div>
          </Card>

          {proposal ? (
            <>
              <Card>
                <CardHeader
                  title="Evidence and unknowns"
                  description="Observed claims come from records. Inferred links are challengeable. Unknowns are not silently filled."
                  actions={<Badge tone={proposal.modelMeta?.degraded ? "amber" : proposal.modelProvider === "gemini" ? "sage" : "neutral"} dot>{proposal.modelProvider === "gemini" ? "Gemini" : proposal.modelProvider === "meta" ? "Meta model" : "Deterministic fallback"}</Badge>}
                />
                <div className="grid gap-4 p-5 lg:grid-cols-2">
                  <div>
                    <p className="label mb-2">Claims</p>
                    {proposal.evidence.length === 0 ? (
                      <p className="text-xs text-ink-faint">No evidence items recorded.</p>
                    ) : (
                      <ul className="space-y-2">
                        {proposal.evidence.map((item) => (
                          <li key={`${item.claim}-${item.sourceType}`} className="rounded-md border border-line p-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <EvidenceBadge state={item.state} />
                              <span className="font-mono text-[9px] uppercase tracking-wide text-ink-faint">{item.sourceType}</span>
                            </div>
                            <p className="mt-1 text-[11px] leading-5 text-ink-soft">{item.claim}</p>
                            {item.excerpt && <p className="mt-1 rounded bg-surface-muted px-2 py-1 font-mono text-[10px] leading-4 text-ink-muted">{item.excerpt}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="space-y-4">
                    <div>
                      <p className="label mb-2">Unknowns</p>
                      {proposal.unknowns.length === 0 ? <p className="text-xs text-ink-faint">None recorded.</p> : (
                        <ul className="space-y-1.5">
                          {proposal.unknowns.map((unknown) => (
                            <li key={unknown} className="flex gap-1.5 text-[11px] leading-5 text-ink-muted"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning-500" />{unknown}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <p className="label mb-2">Clarifying questions</p>
                      {proposal.clarifyingQuestions.length === 0 ? <p className="text-xs text-ink-faint">No clarification requested.</p> : (
                        <ol className="list-decimal space-y-1.5 pl-4">
                          {proposal.clarifyingQuestions.map((question) => (
                            <li key={question} className="text-[11px] leading-5 text-ink-muted">{question}</li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader title="Related records and duplicates" description="Links use explicit evidence states. Duplicate candidates are never merged automatically." />
                <div className="grid gap-4 p-5 lg:grid-cols-2">
                  <div>
                    <p className="label mb-2">Related records</p>
                    {proposal.relatedRecords.length === 0 ? <p className="text-xs text-ink-faint">No related records found.</p> : (
                      <ul className="space-y-2">
                        {proposal.relatedRecords.map((record) => (
                          <li key={`${record.entityType}-${record.entityId}`} className="rounded-md border border-line p-2.5">
                            <div className="flex items-center gap-1.5">
                              <Badge tone="outline">{titleCase(record.entityType)}</Badge>
                              <EvidenceBadge state={record.evidenceState} />
                            </div>
                            <p className="mt-1 font-mono text-[9px] text-ink-faint">{record.entityId}</p>
                            <p className="mt-1 text-[11px] leading-5 text-ink-muted">{record.rationale}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="label mb-2">Duplicate candidates</p>
                    {proposal.duplicateCandidates.length === 0 ? <p className="text-xs text-ink-faint">No duplicate candidates.</p> : (
                      <ul className="space-y-2">
                        {proposal.duplicateCandidates.map((candidate) => (
                          <li key={candidate.ticketId} className="rounded-md border border-line p-2.5">
                            <div className="flex items-center gap-1.5">
                              <Link to={`/tickets/${candidate.ticketId}`} className="font-mono text-[10px] font-semibold text-primary-600 hover:underline">{candidate.ticketId}</Link>
                              <EvidenceBadge state={candidate.evidenceState} />
                            </div>
                            <p className="mt-1 text-[11px] leading-5 text-ink-muted">{candidate.rationale}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </Card>
            </>
          ) : (
            <Card>
              <CardHeader title="No proposal yet" description="Run analysis to generate a proposal. No plan change will be made automatically." />
              <div className="p-5">
                <p className="text-sm text-ink-muted">This ticket is saved but has not produced a decision proposal.</p>
                {canAnalyze && <Button variant="primary" className="mt-3" onClick={() => void analyze()} loading={analyzing}><Sparkles className="h-4 w-4" /> Analyse ticket</Button>}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Decision audit" description="Every action against the proposal, including rejection and clarification." />
            {audits.length === 0 ? (
              <p className="px-5 py-6 text-xs text-ink-muted">No decisions recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line-faint">
                {audits.map((audit) => (
                  <li key={audit.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
                    <div>
                      <p className="text-xs font-semibold text-ink">{titleCase(audit.action)}</p>
                      <p className="mt-0.5 text-[11px] leading-5 text-ink-muted">{audit.reason || "No reason recorded."}</p>
                      <p className="mt-0.5 text-[10px] text-ink-faint">{audit.actorName ?? "Unknown actor"}</p>
                    </div>
                    <span className="font-mono text-[10px] text-ink-faint">{formatDateTime(audit.timestamp)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {proposal ? (
            <>
              <Card>
                <div className="border-b border-line px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={proposal.status} />
                    <PriorityBadge priority={proposal.classification.priority} />
                    <Badge tone="outline">Base plan v{proposal.basePlanVersion}</Badge>
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-ink">{titleCase(proposal.recommendation)} recommended</h2>
                  <p className="mt-1 text-xs leading-5 text-ink-muted">{proposal.summary}</p>
                </div>
                <div className="space-y-3 p-5">
                  <div>
                    <p className="label">Why this recommendation</p>
                    <p className="mt-1 text-xs leading-5 text-ink-soft">{proposal.recommendationRationale}</p>
                  </div>
                  <div className="rounded-md border border-line bg-surface-muted p-3">
                    <p className="text-[10px] font-semibold text-ink">Classification</p>
                    <p className="mt-1 text-[11px] leading-5 text-ink-muted">{proposal.classification.summary}</p>
                    <p className="mt-1 text-[11px] leading-5 text-ink-muted"><strong className="text-ink">Impact:</strong> {proposal.classification.businessImpact}</p>
                  </div>
                  <div>
                    <p className="label">Policy outcome</p>
                    <p className="mt-1 text-[11px] text-ink-muted">
                      Model priority {proposal.policy.modelPriority} → final {proposal.policy.finalPriority} · {proposal.policy.responseWindowLabel}
                      {proposal.policy.escalated && " · escalated"}
                    </p>
                    <ul className="mt-1 list-disc pl-4">
                      {proposal.policy.rulesApplied.map((rule) => <li key={rule} className="text-[10px] leading-4 text-ink-faint">{rule}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-md border border-line px-3 py-2">
                    <p className="flex items-center gap-1 text-[10px] text-ink-faint"><ShieldCheck className="h-3 w-3" /> Approval required</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-ink-muted">
                      Only a project owner or PM can approve. Viewer and member roles may review RippleMap but cannot commit a plan version.
                    </p>
                  </div>
                  {proposal.status === "pending" ? (
                    <Link to={`/ripplemap/${proposal.id}`} className="btn-primary w-full justify-between">
                      Review impact <ArrowRight className="h-4 w-4" />
                    </Link>
                  ) : (
                    <div className="rounded-md border border-line bg-surface-muted px-3 py-2 text-[11px] text-ink-muted">
                      This proposal is {proposal.status}. The current plan is unchanged.
                    </div>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader title="Model provenance" description="How the analysis was produced." />
                <dl className="space-y-2 p-5 text-[11px]">
                  {[
                    ["Provider", proposal.modelProvider],
                    ["Model", proposal.modelName],
                    ["Degraded", proposal.modelMeta?.degraded ? "Yes — fallback used" : "No"],
                    ["Latency", proposal.modelMeta ? `${proposal.modelMeta.latencyMs}ms` : "Unknown"],
                    ["Created", formatDateTime(proposal.createdAt)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3 border-b border-line-faint pb-1.5">
                      <dt className="text-ink-faint">{label}</dt>
                      <dd className="text-right font-medium text-ink-soft">{value}</dd>
                    </div>
                  ))}
                </dl>
                {proposal.modelMeta?.notice && <div className="border-t border-line px-5 py-3 text-[10px] leading-5 text-warning-600">{proposal.modelMeta.notice}</div>}
              </Card>
            </>
          ) : (
            <Card>
              <CardHeader title="Proposal" />
              <div className="p-5 text-xs text-ink-muted">Analysis has not produced a proposal for this ticket.</div>
            </Card>
          )}

          <Card>
            <CardHeader title="Linked plan records" description="Relationships confirmed from the proposal." />
            {links.length === 0 ? (
              <p className="p-5 text-xs text-ink-muted">No plan records are linked.</p>
            ) : (
              <ul className="divide-y divide-line-faint">
                {links.map((link) => (
                  <li key={link.id} className="px-5 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Badge tone="outline">{titleCase(link.entityType)}</Badge>
                      <EvidenceBadge state={link.evidenceState} />
                      {link.confirmed && <Badge tone="sage">Confirmed</Badge>}
                    </div>
                    <p className="mt-1 text-[11px] text-ink">{link.entityLabel ?? link.entityId}</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-ink-faint">{link.rationale}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
