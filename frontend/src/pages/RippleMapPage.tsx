import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarRange,
  CheckCircle2,
  CircleHelp,
  Clock3,
  GitBranch,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import type {
  DecisionOption,
  DecisionProposal,
  ProjectPlan,
  ScenarioResult,
} from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError, type DecisionQueueItem } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { cn, formatDate, formatDateTime, formatShortDate, priorityTone, titleCase } from "../lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBlock,
  EvidenceBadge,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  PriorityBadge,
  ProgressBar,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
} from "../components/ui";

const OPTION_LABEL: Record<DecisionOption, string> = {
  accept: "Accept change",
  split: "Accept split scope",
  defer: "Defer without change",
  clarify: "Request clarification",
  duplicate: "Mark duplicate",
};

const OPTION_HINT: Record<DecisionOption, string> = {
  accept: "Apply the full proposed change and create a new plan version.",
  split: "Apply only the safe subset proposed by the analysis.",
  defer: "Record the decision without changing the plan.",
  clarify: "Ask for missing evidence; no plan change.",
  duplicate: "Link to an existing ticket; no plan change.",
};

export function RippleMapPage() {
  const { decisionId } = useParams();
  if (decisionId) return <DecisionCard decisionId={decisionId} />;
  return <DecisionQueue />;
}

function DecisionQueue() {
  const { projects, activeWorkspace } = useWorkspace();
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const { data, loading, error, reload } = useAsync<{ decisions: DecisionQueueItem[] }>(
    () => api.decisions.list("pending"),
    [],
  );

  const visible = useMemo(() => {
    const value = search.trim().toLowerCase();
    return (data?.decisions ?? []).filter(
      (decision) =>
        (projectFilter === "all" || decision.projectId === projectFilter) &&
        (!value || `${decision.ticketTitle} ${decision.projectName}`.toLowerCase().includes(value)),
    );
  }, [data, search, projectFilter]);

  return (
    <div>
      <PageHeader
        eyebrow={activeWorkspace?.name}
        title="RippleMap"
        description="Deterministic before/after simulation for every proposed change. Review evidence, schedule, dependencies, capacity and policy findings before a human approves."
        actions={
          <Link to="/tickets" className="btn-secondary">
            <GitCompareArrows className="h-4 w-4" /> Ticket inbox
          </Link>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          ["Pending decisions", data?.decisions.length ?? 0, "Awaiting human approval"],
          ["Projects represented", new Set((data?.decisions ?? []).map((decision) => decision.projectId)).size, "Across this workspace"],
          ["Observed plan state", projects.reduce((sum, project) => sum + project.taskCount, 0), "Current task count from approved plans"],
        ].map(([label, value, hint]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs text-ink-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
            <p className="mt-1 text-[10px] text-ink-faint">{hint}</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search pending decisions…" aria-label="Search pending decisions" />
          </div>
          <Select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="w-auto max-w-[260px]" aria-label="Filter decisions by project">
            <option value="all">All projects</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>
          <Button variant="ghost" className="ml-auto" onClick={() => void reload()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
        {loading ? (
          <LoadingBlock label="Loading decision queue" />
        ) : error ? (
          <div className="p-4"><ErrorBlock message={error} onRetry={() => void reload()} /></div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No pending decisions"
            description="There is nothing awaiting approval in this workspace. New proposals appear after ticket analysis."
            action={<Link to="/tickets" className="btn-primary">Open ticket inbox</Link>}
          />
        ) : (
          <ul className="divide-y divide-line-faint">
            {visible.map((decision) => (
              <li key={decision.id}>
                <Link to={`/ripplemap/${decision.id}`} className="group grid gap-3 px-4 py-4 transition-colors hover:bg-surface-muted sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600">
                      <GitCompareArrows className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink group-hover:text-primary-700">{decision.ticketTitle}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-ink-faint">
                        <span>{decision.projectName}</span>
                        <span>·</span>
                        <span>{formatDateTime(decision.createdAt)}</span>
                        <span>·</span>
                        <span className="font-mono">{decision.id}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Badge tone={decision.recommendation === "accept" ? "sage" : decision.recommendation === "split" ? "primary" : "amber"}>
                      {OPTION_LABEL[decision.recommendation]}
                    </Badge>
                    <PriorityBadge priority={decision.priority} />
                    <ArrowRight className="h-4 w-4 text-ink-faint transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-line px-4 py-2.5 text-[10px] text-ink-faint">
          Simulation is deterministic and uses the approved plan, dependencies, working days and stated capacity. AI never approves.
        </div>
      </Card>
    </div>
  );
}

interface DecisionData {
  proposal: DecisionProposal;
  plan: ProjectPlan;
}

function DecisionCard({ decisionId }: { decisionId: string }) {
  const { projects, role } = useWorkspace();
  const { toast } = useToast();
  const { data, loading, error, reload } = useAsync<DecisionData>(async () => {
    const proposal = await api.decisions.get(decisionId);
    const plan = await api.projects.getPlan(proposal.projectId);
    return { proposal, plan };
  }, [decisionId]);

  const [option, setOption] = useState<DecisionOption>("accept");
  const [scenario, setScenario] = useState<ScenarioResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simErrorCode, setSimErrorCode] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [reason, setReason] = useState("");
  const [busyAction, setBusyAction] = useState<"approve" | "reject" | "clarify" | null>(null);
  const [actionDialog, setActionDialog] = useState<"reject" | "clarify" | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [questions, setQuestions] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ message: string; planVersionNumber: number | null } | null>(null);

  const project = data ? projects.find((candidate) => candidate.id === data.proposal.projectId) : null;
  const canApprove = project?.role === "owner" || project?.role === "pm";
  const availableOptions = useMemo<DecisionOption[]>(() => {
    if (!data) return ["accept"];
    const options: DecisionOption[] = ["accept"];
    if (data.proposal.proposedChanges.split) options.push("split");
    options.push("defer");
    if (data.proposal.duplicateCandidates.length > 0) options.push("duplicate");
    return options;
  }, [data]);

  const isStale = stale || (data ? data.plan.version !== data.proposal.basePlanVersion : false);
  const pending = data?.proposal.status === "pending";

  const selectOption = (next: DecisionOption) => {
    setOption(next);
    setScenario(null);
    setSimError(null);
    setSimErrorCode(null);
  };

  const simulate = async (next: DecisionOption = option) => {
    if (!data || !pending || isStale) return;
    setSimLoading(true);
    setSimError(null);
    setSimErrorCode(null);
    setScenario(null);
    try {
      const result = await api.decisions.simulate(data.proposal.id, next, data.proposal.basePlanVersion);
      setScenario(result);
      if (!result.valid) {
        setSimError("This option produces an invalid schedule. Review the validation errors below; approval is blocked.");
      }
    } catch (cause) {
      const apiError = cause instanceof ApiError ? cause : null;
      setSimErrorCode(apiError?.code ?? null);
      setSimError(apiError?.message ?? "The simulation failed. The plan may have changed or the server may be unavailable.");
      if (apiError?.code === "STALE_PROPOSAL" || apiError?.code === "BASELINE_VERSION_MISMATCH" || apiError?.code === "DECISION_NOT_PENDING") {
        setStale(true);
      }
    } finally {
      setSimLoading(false);
    }
  };

  useEffect(() => {
    if (!data) return;
    if (data.proposal.status !== "pending") return;
    if (data.plan.version !== data.proposal.basePlanVersion) {
      setStale(true);
      return;
    }
    const recommended = data.proposal.recommendation;
    const preferred = recommended;
    setOption(preferred);
    void simulate(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.proposal.id, data?.proposal.status, data?.plan.version]);

  const approve = async () => {
    if (!data || !scenario || !scenario.valid || scenario.option !== option) return;
    if (reason.trim().length < 5) {
      toast("Record an approval reason of at least five characters.", "error");
      return;
    }
    setBusyAction("approve");
    setActionError(null);
    try {
      const result = await api.decisions.approve(data.proposal.id, option, reason.trim());
      setOutcome({ message: result.message, planVersionNumber: result.planVersionNumber });
      toast(result.message, "success");
    } catch (cause) {
      const apiError = cause instanceof ApiError ? cause : null;
      setActionError(apiError?.message ?? "The decision could not be approved.");
      if (apiError?.code === "STALE_PROPOSAL" || apiError?.code === "SCENARIO_STALE") {
        setStale(true);
        setScenario(null);
      }
      if (apiError?.code === "SCENARIO_REQUIRED") {
        await simulate(option);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const reject = async () => {
    if (!data) return;
    if (actionReason.trim().length < 3) {
      setActionError("A rejection reason of at least three characters is required.");
      return;
    }
    setBusyAction("reject");
    setActionError(null);
    try {
      const result = await api.decisions.reject(data.proposal.id, actionReason.trim());
      setOutcome({ message: result.message, planVersionNumber: result.planVersionNumber });
      setActionDialog(null);
      toast("Proposal rejected. The plan is unchanged.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "Rejection failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const clarify = async () => {
    if (!data) return;
    const list = questions.split("\n").map((question) => question.trim()).filter(Boolean);
    if (actionReason.trim().length < 3) {
      setActionError("A clarification reason of at least three characters is required.");
      return;
    }
    setBusyAction("clarify");
    setActionError(null);
    try {
      const result = await api.decisions.clarify(data.proposal.id, {
        reason: actionReason.trim(),
        questions: list,
      });
      setOutcome({ message: result.message, planVersionNumber: result.planVersionNumber });
      setActionDialog(null);
      toast("Clarification requested. The ticket is marked for more information.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "Clarification request failed.");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow={<Link to="/ripplemap" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> RippleMap</Link>} title="Loading decision" />
        <LoadingBlock label="Simulating nothing yet — loading the approved plan and proposal" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader eyebrow={<Link to="/ripplemap" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> RippleMap</Link>} title="Decision unavailable" />
        <ErrorBlock message={error ?? "The decision could not be loaded."} onRetry={() => void reload()} />
      </div>
    );
  }

  const { proposal, plan } = data;
  const observed = proposal.evidence.filter((item) => item.state === "observed").length;
  const inferred = proposal.evidence.filter((item) => item.state === "inferred").length;
  const unknown = proposal.evidence.filter((item) => item.state === "unknown").length + proposal.unknowns.length;
  const afterTaskCount = scenario?.tasks.length ?? plan.tasks.length;
  const beforeEffort = plan.tasks.reduce((sum, task) => sum + task.estimateDays, 0);

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Link to="/ripplemap" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> RippleMap</Link>
            <span className="text-line-strong">/</span>
            <span>{project?.name ?? "Project"}</span>
            <span className="text-line-strong">·</span>
            <Link to={`/tickets/${proposal.ticketId}`} className="font-mono hover:text-ink">{proposal.ticketId}</Link>
          </>
        }
        title="Review change impact"
        description={proposal.summary}
        actions={
          <>
            <StatusBadge status={proposal.status} />
            <Badge tone="outline">Base plan v{proposal.basePlanVersion}</Badge>
            <Button variant="ghost" onClick={() => void reload()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
          </>
        }
        meta={
          <>
            <Badge tone={proposal.modelProvider === "gemini" ? "sage" : proposal.modelProvider === "meta" ? "primary" : "amber"} dot>
              {proposal.modelProvider === "gemini" ? "Gemini analysis" : proposal.modelProvider === "meta" ? "Meta model analysis" : "Deterministic analysis"}
            </Badge>
            <span className="font-mono text-[10px] text-ink-faint">{proposal.modelName}</span>
            <span>· {formatDateTime(proposal.createdAt)}</span>
            <PriorityBadge priority={proposal.classification.priority} />
            <span>· {observed} observed · {inferred} inferred · {unknown} unknown</span>
          </>
        }
      />

      {outcome && (
        <div className="mb-4">
          <Alert tone="success" title="Decision recorded">
            {outcome.message}
            {outcome.planVersionNumber ? ` New immutable plan version: v${outcome.planVersionNumber}.` : " The plan was not changed."}
            <div className="mt-2 flex flex-wrap gap-2">
              <Link to={`/projects/${proposal.projectId}?tab=history`} className="btn-secondary min-h-8 px-2.5 py-1.5 text-xs">Project history</Link>
              <Link to="/ripplemap" className="btn-ghost min-h-8 px-2.5 py-1.5 text-xs">Back to queue</Link>
            </div>
          </Alert>
        </div>
      )}

      {(isStale || proposal.status === "stale") && (
        <div className="mb-4">
          <Alert
            tone="danger"
            title="Stale proposal — approval is blocked"
            action={<Link to={`/tickets/${proposal.ticketId}`} className="btn-secondary min-h-8 px-2.5 py-1.5 text-xs">Open ticket</Link>}
          >
            This proposal was computed against plan v{proposal.basePlanVersion}, but the project is now at
            plan v{plan.version}. Re-analyse the ticket to generate a new proposal against the current plan.
          </Alert>
        </div>
      )}

      {!pending && !outcome && (
        <div className="mb-4">
          <Alert tone="warning" title={`Proposal is ${proposal.status}`}>
            This proposal can no longer be approved. The current plan is unchanged.
          </Alert>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Choose an option"
              description="Changing the option runs a new deterministic simulation. A simulation is required before approval."
              actions={scenario && <Badge tone={scenario.valid ? "sage" : "danger"} dot>{scenario.valid ? "Valid scenario" : "Invalid scenario"}</Badge>}
            />
            <div className="space-y-4 p-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {availableOptions.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => selectOption(candidate)}
                    disabled={!pending || isStale}
                    className={cn(
                      "rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      option === candidate ? "border-primary-400 bg-primary-50" : "border-line bg-surface hover:bg-surface-muted",
                    )}
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold text-ink">
                      {option === candidate && <CheckCircle2 className="h-3.5 w-3.5 text-primary-600" />}
                      {OPTION_LABEL[candidate]}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-ink-muted">{OPTION_HINT[candidate]}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] text-ink-faint">
                  {proposal.recommendation === option
                    ? "This is the analyser’s recommended option. It is still only a proposal."
                    : `The analyser recommended “${OPTION_LABEL[proposal.recommendation]}”. You are reviewing a different option.`}
                </p>
                <Button variant="secondary" onClick={() => void simulate()} loading={simLoading} disabled={!pending || isStale}>
                  <RefreshCw className="h-3.5 w-3.5" /> {scenario ? "Simulate again" : "Simulate impact"}
                </Button>
              </div>
              {simError && (
                <Alert tone="danger" title={simErrorCode === "SCENARIO_INVALID" ? "Scenario invalid" : "Simulation failed"}>
                  {simError}
                  {scenario && scenario.validationErrors.length > 0 && (
                    <ul className="mt-1 list-disc pl-4">{scenario.validationErrors.map((message) => <li key={message}>{message}</li>)}</ul>
                  )}
                </Alert>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Before / after"
              description="Baseline is the approved plan. After reflects the selected option and deterministic schedule."
              actions={<span className="font-mono text-[10px] text-ink-faint">Plan v{proposal.basePlanVersion} → {scenario && (option === "accept" || option === "split") ? `v${proposal.basePlanVersion + 1}` : "no new version"}</span>}
            />
            {simLoading ? (
              <div className="flex items-center gap-2 px-5 py-10 text-sm text-ink-muted"><Spinner /> Simulating {OPTION_LABEL[option].toLowerCase()}…</div>
            ) : !scenario ? (
              <EmptyState
                icon={GitCompareArrows}
                title={simError ? "No scenario available" : "Simulation required"}
                description={simError ?? "Choose an option and simulate impact before approving. The plan is never mutated by simulation."}
                action={<Button variant="primary" onClick={() => void simulate()} disabled={!pending || isStale}>Simulate {OPTION_LABEL[option].toLowerCase()}</Button>}
                compact
              />
            ) : (
              <div className="space-y-5 p-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Tasks", `${plan.tasks.length} → ${afterTaskCount}`, scenario.metrics.tasksAdded - scenario.metrics.tasksRemoved],
                    ["Effort", `${Math.round(beforeEffort)}d → ${Math.round(scenario.metrics.totalEffortDays)}d`, scenario.metrics.effortAddedDays],
                    ["Schedule", `${scenario.metrics.scheduleDeltaDays > 0 ? "+" : ""}${scenario.metrics.scheduleDeltaDays}d`, scenario.metrics.scheduleDeltaDays],
                    ["Milestones", `${plan.milestones.length} → ${scenario.milestones.length}`, scenario.metrics.milestonesBreached],
                  ].map(([label, value, delta]) => (
                    <div key={String(label)} className="rounded-md border border-line bg-surface-muted p-3">
                      <p className="label">{label}</p>
                      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
                      <p className={cn("mt-0.5 font-mono text-[10px]", Number(delta) > 0 ? "text-warning-600" : "text-ink-faint")}>
                        {Number(delta) > 0 ? `+${delta}` : delta}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-line bg-surface-muted p-3">
                    <p className="label">Baseline</p>
                    <p className="mt-1 text-xs font-semibold text-ink">Plan v{proposal.basePlanVersion}</p>
                    <p className="mt-1 text-[10px] text-ink-muted">{plan.tasks.length} tasks · {Math.round(beforeEffort)} person-days · {plan.milestones.length} milestones</p>
                  </div>
                  <div className="rounded-md border border-primary-100 bg-primary-50 p-3">
                    <p className="label">After approval</p>
                    <p className="mt-1 text-xs font-semibold text-ink">Plan v{proposal.basePlanVersion + 1}</p>
                    <p className="mt-1 text-[10px] text-ink-muted">{afterTaskCount} tasks · {Math.round(scenario.metrics.totalEffortDays)} person-days · {scenario.milestones.length} milestones</p>
                  </div>
                </div>

                <DiffSections scenario={scenario} plan={plan} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Card className="p-3">
                    <p className="label">Capacity</p>
                    {scenario.capacity ? (
                      <>
                        <p className="mt-1 text-xs text-ink">
                          {scenario.capacity.statedCapacityPersonDays === null
                            ? "No stated capacity in the plan."
                            : `${Math.round(scenario.capacity.scheduledEffortDays)} of ${scenario.capacity.statedCapacityPersonDays} person-days scheduled`}
                        </p>
                        {scenario.capacity.utilizationPercent !== null && (
                          <div className="mt-2"><ProgressBar value={scenario.capacity.utilizationPercent} label="Utilisation" tone={scenario.capacity.utilizationPercent > 100 ? "danger" : scenario.capacity.utilizationPercent > 85 ? "amber" : "primary"} /></div>
                        )}
                        <p className="mt-2 text-[10px] leading-4 text-ink-faint">{scenario.capacity.note}</p>
                      </>
                    ) : (
                      <p className="mt-1 text-xs text-ink-muted">Capacity was not available for this scenario.</p>
                    )}
                  </Card>
                  <Card className="p-3">
                    <p className="label">Policy findings</p>
                    {scenario.policyFindings.length === 0 ? (
                      <p className="mt-1 text-xs text-ink-muted">No policy findings for this option.</p>
                    ) : (
                      <ul className="mt-1.5 space-y-1.5">
                        {scenario.policyFindings.map((finding) => (
                          <li key={`${finding.code}-${finding.message}`} className="flex gap-1.5 text-[10px] leading-4">
                            <Badge tone={finding.severity === "critical" ? "danger" : finding.severity === "warning" ? "amber" : "neutral"}>{finding.severity}</Badge>
                            <span className="text-ink-muted">{finding.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>

                {scenario.validationWarnings.length > 0 && (
                  <Alert tone="warning" title="Scenario warnings">
                    <ul className="list-disc pl-4">{scenario.validationWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </Alert>
                )}

                {scenario.assumptions.length > 0 && (
                  <div>
                    <p className="label mb-1.5">Scenario assumptions</p>
                    <ul className="space-y-1">{scenario.assumptions.map((assumption) => <li key={assumption} className="flex gap-1.5 text-[10px] leading-4 text-ink-muted"><Badge tone="amber">Inferred</Badge>{assumption}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Human decision" description="Simulation is evidence, not approval. Only an owner or PM can commit a new plan version." />
            <div className="space-y-4 p-5">
              <div className="rounded-md border border-line bg-surface-muted p-3">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold text-ink"><ShieldCheck className="h-3.5 w-3.5 text-primary-600" /> Approval authority</p>
                <p className="mt-1 text-[11px] leading-5 text-ink-muted">
                  {canApprove
                    ? `Your project role is ${titleCase(project?.role ?? "")}. You can approve an option after simulating it.`
                    : `Your project role is ${titleCase(project?.role ?? "unknown")}. You may review the impact, but only an owner or PM can approve.`}
                </p>
              </div>
              <Field label="Approval reason" htmlFor="approval-reason" hint="Recorded in immutable decision history. Minimum five characters.">
                <Textarea id="approval-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this option acceptable? Include any mitigation." disabled={!pending || Boolean(outcome)} />
              </Field>
              {actionError && <Alert tone="danger">{actionError}</Alert>}
              <Button
                variant="primary"
                className="w-full justify-between"
                loading={busyAction === "approve"}
                disabled={!pending || !canApprove || isStale || !scenario || !scenario.valid || scenario.option !== option || Boolean(outcome)}
                onClick={() => void approve()}
              >
                Approve {OPTION_LABEL[option].toLowerCase()} <ArrowRight className="h-4 w-4" />
              </Button>
              {!scenario && <p className="text-center text-[10px] text-ink-faint">Simulate the selected option to enable approval.</p>}
              {scenario && !scenario.valid && <p className="text-center text-[10px] text-danger-600">Invalid scenarios cannot be approved.</p>}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={!pending || Boolean(outcome)} onClick={() => { setActionError(null); setActionReason(""); setActionDialog("reject"); }}>Reject</Button>
                <Button variant="secondary" disabled={!pending || Boolean(outcome)} onClick={() => { setActionError(null); setActionReason(""); setQuestions(proposal.clarifyingQuestions.join("\n")); setActionDialog("clarify"); }}>Ask for clarity</Button>
              </div>
              <p className="text-[10px] leading-4 text-ink-faint">
                Rejection and clarification leave the plan unchanged. Accept and split create a new immutable plan version only after the server verifies the stored scenario still matches the current plan.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Evidence provenance" description="Observed, inferred and unknown signals are kept distinct." />
            <div className="grid grid-cols-3 gap-2 p-4">
              {[
                ["Observed", observed, "sage"],
                ["Inferred", inferred, "amber"],
                ["Unknown", unknown, "neutral"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="rounded-md border border-line bg-surface-muted p-2.5 text-center">
                  <p className="text-lg font-semibold text-ink">{value}</p>
                  <Badge tone={tone as "sage" | "amber" | "neutral"}>{label}</Badge>
                </div>
              ))}
            </div>
            <ul className="divide-y divide-line-faint">
              {proposal.evidence.slice(0, 6).map((item) => (
                <li key={`${item.claim}-${item.sourceType}`} className="px-4 py-2.5">
                  <EvidenceBadge state={item.state} />
                  <p className="mt-1 text-[10px] leading-4 text-ink-muted">{item.claim}</p>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-2.5">
              <Link to={`/tickets/${proposal.ticketId}`} className="text-[10px] font-semibold text-primary-600 hover:underline">Open source ticket and full evidence</Link>
            </div>
          </Card>

          <Card>
            <CardHeader title="Decision audit" description="Permanent record for this proposal." />
            <ul className="divide-y divide-line-faint">
              {proposal.scenarioRuns.length === 0 ? (
                <li className="px-4 py-4 text-[11px] text-ink-muted">No stored simulation runs yet.</li>
              ) : (
                proposal.scenarioRuns.map((run) => (
                  <li key={run.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-ink">{OPTION_LABEL[run.option]}</span>
                      <Badge tone={run.valid ? "sage" : "danger"}>{run.valid ? "Valid" : "Invalid"}</Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-[9px] text-ink-faint">{formatDateTime(run.createdAt)} · {run.inputHash.slice(0, 12)}…</p>
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>
      </div>

      <ModalAction
        open={actionDialog !== null}
        mode={actionDialog}
        reason={actionReason}
        questions={questions}
        setReason={setActionReason}
        setQuestions={setQuestions}
        error={actionError}
        busy={busyAction}
        onClose={() => setActionDialog(null)}
        onSubmit={actionDialog === "reject" ? reject : clarify}
      />
    </div>
  );
}

function DiffSections({ scenario, plan }: { scenario: ScenarioResult; plan: ProjectPlan }) {
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-sage-100 bg-sage-50 p-3">
          <p className="flex items-center justify-between text-[10px] font-semibold text-sage-700"><span>Added tasks</span><span>{scenario.diff.addedTasks.length}</span></p>
          {scenario.diff.addedTasks.length === 0 ? <p className="mt-1 text-[10px] text-ink-muted">None.</p> : (
            <ul className="mt-2 space-y-1.5">
              {scenario.diff.addedTasks.map((task) => (
                <li key={task.id} className="text-[10px] leading-4 text-ink-soft">
                  <span className="font-medium text-ink">{task.title}</span> · {task.estimateDays}d · {formatShortDate(task.plannedStart)} → {formatShortDate(task.plannedFinish)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-md border border-line bg-surface-muted p-3">
          <p className="flex items-center justify-between text-[10px] font-semibold text-ink"><span>Removed tasks</span><span>{scenario.diff.removedTasks.length}</span></p>
          {scenario.diff.removedTasks.length === 0 ? <p className="mt-1 text-[10px] text-ink-muted">None.</p> : (
            <ul className="mt-2 space-y-1.5">
              {scenario.diff.removedTasks.map((task) => <li key={task.taskId} className="text-[10px] leading-4 text-ink-soft line-through">{task.title}</li>)}
            </ul>
          )}
        </div>
      </div>

      {scenario.diff.changedTasks.length > 0 && (
        <div className="rounded-md border border-line p-3">
          <p className="text-[10px] font-semibold text-ink">Changed tasks <span className="font-mono text-ink-faint">({scenario.diff.changedTasks.length})</span></p>
          <ul className="mt-2 space-y-2">
            {scenario.diff.changedTasks.map((change) => (
              <li key={change.taskId}>
                <p className="text-[10px] font-medium text-ink">{change.title}</p>
                <ul className="mt-1 space-y-0.5">
                  {change.changes.map((field) => (
                    <li key={`${change.taskId}-${field.field}`} className="font-mono text-[9px] text-ink-faint">
                      {field.field}: <span className="text-ink-muted">{String(field.before ?? "—")}</span> → <span className="text-ink">{String(field.after ?? "—")}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {scenario.diff.addedDependencies.length > 0 && (
        <div className="rounded-md border border-line p-3">
          <p className="text-[10px] font-semibold text-ink">Added dependencies</p>
          <ul className="mt-2 space-y-1.5">
            {scenario.diff.addedDependencies.map((dep) => (
              <li key={`${dep.predecessorId}-${dep.successorId}`} className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink-muted">
                <GitBranch className="h-3 w-3" />
                <span>{taskById.get(dep.predecessorId)?.title ?? dep.predecessorId}</span>
                <Chevron />
                <span>{taskById.get(dep.successorId)?.title ?? dep.successorId}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {scenario.diff.milestoneDeltas.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left">
            <thead><tr>
              <th className="table-head border-b border-line">Milestone</th>
              <th className="table-head border-b border-line">Target</th>
              <th className="table-head border-b border-line">Baseline</th>
              <th className="table-head border-b border-line">Simulated</th>
              <th className="table-head border-b border-line">Delta</th>
              <th className="table-head border-b border-line">Target delta</th>
            </tr></thead>
            <tbody>
              {scenario.diff.milestoneDeltas.map((milestone) => (
                <tr key={milestone.milestoneId} className={milestone.breached ? "bg-danger-50" : undefined}>
                  <td className="table-cell border-b border-line-faint text-xs font-medium text-ink">{milestone.title}</td>
                  <td className="table-cell border-b border-line-faint text-[10px]">{formatShortDate(milestone.targetDate)}</td>
                  <td className="table-cell border-b border-line-faint text-[10px]">{formatShortDate(milestone.baselineDate)}</td>
                  <td className="table-cell border-b border-line-faint text-[10px]">{formatShortDate(milestone.simulatedDate)}</td>
                  <td className={cn("table-cell border-b border-line-faint font-mono text-[10px]", milestone.deltaDays > 0 ? "text-warning-600" : "text-sage-700")}>{milestone.deltaDays > 0 ? `+${milestone.deltaDays}d` : `${milestone.deltaDays}d`}</td>
                  <td className="table-cell border-b border-line-faint">
                    {milestone.breached ? <Badge tone="danger">Breached</Badge> : milestone.targetDeltaDays !== null ? <span className="font-mono text-[10px] text-ink-muted">{milestone.targetDeltaDays > 0 ? `+${milestone.targetDeltaDays}d` : `${milestone.targetDeltaDays}d`}</span> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scenario.tasks.some((task) => task.status === "blocked") && (
        <div className="rounded-md border border-danger-100 bg-danger-50 p-3">
          <p className="text-[10px] font-semibold text-danger-600">Blocked tasks after simulation</p>
          <ul className="mt-1.5 space-y-1">
            {scenario.tasks.filter((task) => task.status === "blocked").map((task) => <li key={task.id} className="text-[10px] text-ink-soft">{task.title} · {task.estimateDays}d</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Chevron() {
  return <span className="text-ink-faint">→</span>;
}

function ModalAction({
  open,
  mode,
  reason,
  questions,
  setReason,
  setQuestions,
  error,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "reject" | "clarify" | null;
  reason: string;
  questions: string;
  setReason: (value: string) => void;
  setQuestions: (value: string) => void;
  error: string | null;
  busy: "approve" | "reject" | "clarify" | null;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  return (
    <Modal open={open} onOpenChange={(value) => { if (!value) onClose(); }} title={mode === "clarify" ? "Request clarification" : "Reject proposal"} description={mode === "clarify" ? "No plan change. The ticket is marked for more information." : "The plan remains unchanged. The rejection is recorded in the audit trail."} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={mode === "clarify" ? "primary" : "danger"} loading={busy !== null} onClick={() => void onSubmit()}>{mode === "clarify" ? "Request clarification" : "Reject proposal"}</Button></>}
    >
      <div className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Reason" htmlFor="action-reason" required>
          <Textarea id="action-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={mode === "clarify" ? "What information is missing and why does it block a decision?" : "Why is this proposal rejected?"} />
        </Field>
        {mode === "clarify" && (
          <Field label="Questions for the reporter" htmlFor="action-questions" hint="One question per line.">
            <Textarea id="action-questions" value={questions} onChange={(event) => setQuestions(event.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
