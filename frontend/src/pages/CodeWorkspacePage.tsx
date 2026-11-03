import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  Code2,
  FileText,
  GitBranch,
  KeyRound,
  Network,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { formatDateTime, titleCase } from "../lib/format";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  LoadingBlock,
  PageHeader,
  StatCard,
} from "../components/ui";

interface Usage {
  usage: Array<{
    workflow: string;
    provider: string;
    model: string;
    calls: number;
    degraded: number;
    last_call: string;
  }>;
}

export function CodeWorkspacePage() {
  const { activeWorkspace, activeOrganization, aiMode } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? "";
  const { data, loading, error } = useAsync<Usage>(
    () => api.ai.usage(workspaceId),
    [workspaceId],
  );

  const usage = useMemo(() => data?.usage ?? [], [data]);
  const calls = usage.reduce((sum, row) => sum + row.calls, 0);
  const degraded = usage.reduce((sum, row) => sum + row.degraded, 0);

  return (
    <div>
      <PageHeader
        eyebrow={`${activeOrganization?.name ?? "Organization"} · ${activeWorkspace?.name ?? "Workspace"}`}
        title="Code Workspace"
        description="Repository-linked delivery is not enabled in this build. This page reports the integration boundary honestly rather than showing placeholder commits, branches or pull requests."
        actions={
          <>
            <Link to="/docs" className="btn-secondary"><FileText className="h-4 w-4" /> Architecture notes</Link>
            <Link to="/settings" className="btn-primary"><Braces className="h-4 w-4" /> AI configuration</Link>
          </>
        }
        meta={
          <>
            <Badge tone="amber" dot>Repository integration deferred</Badge>
            <span>No source code, commits or diffs are fabricated</span>
            <span>· Workspace context remains available to planning</span>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Repository links" value="0" hint="No repository provider is connected" icon={GitBranch} tone="neutral" />
        <StatCard label="AI calls recorded" value={calls} hint="Across planning, analysis and assistant workflows" icon={TerminalSquare} tone="primary" />
        <StatCard label="Fallback calls" value={degraded} hint="Labelled deterministic responses" icon={ShieldCheck} tone={degraded > 0 ? "amber" : "sage"} />
        <StatCard label="Current provider" value={aiMode?.usesGemini ? "Gemini" : aiMode?.usesMeta ? "Meta" : "Fallback"} hint={aiMode?.model ?? "Status loading"} icon={Code2} tone={aiMode?.usesGemini ? "sage" : "neutral"} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader
            title="Why this module is deferred"
            description="A code workspace needs a real repository provider, access model, webhook verification and secret handling. None of those are present, so no controls are shown."
          />
          <div className="space-y-4 p-5">
            <Alert tone="warning" title="Not a simulated integration">
              The backend has no repository, branch, commit, pull-request or code-search endpoints. Adding decorative controls would
              misrepresent what the product can do. This module is intentionally read-only.
            </Alert>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  icon: GitBranch,
                  title: "Repository connection",
                  text: "OAuth or GitHub App installation, repository scoping and webhook verification are not implemented.",
                  state: "Deferred",
                },
                {
                  icon: Code2,
                  title: "Code and diff review",
                  text: "No source files are ingested. Planning evidence still comes from tickets, project records and documents.",
                  state: "Deferred",
                },
                {
                  icon: Network,
                  title: "Change-to-code linkage",
                  text: "RippleMap links plan records to tickets. Linking a task to a real commit requires the repository integration.",
                  state: "Deferred",
                },
                {
                  icon: KeyRound,
                  title: "Least-privilege access",
                  text: "A code integration must enforce repository permissions separately from workspace roles. That model is not built.",
                  state: "Required first",
                },
              ].map((item) => (
                <div key={item.title} className="rounded-md border border-line bg-surface-muted p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <item.icon className="h-4 w-4 text-primary-500" />
                    <Badge tone={item.state === "Required first" ? "danger" : "amber"}>{item.state}</Badge>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-ink">{item.title}</p>
                  <p className="mt-1 text-[11px] leading-5 text-ink-muted">{item.text}</p>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-line p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink"><CheckCircle2 className="h-3.5 w-3.5 text-sage-600" /> What is available now</p>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-5 text-ink-muted">
                <li>• Deterministic impact simulation over the approved plan, dependencies, milestones and capacity.</li>
                <li>• Ticket evidence states, human approval and immutable plan history.</li>
                <li>• Workspace documentation for architecture decisions and diagram source.</li>
                <li>• AI configuration status and usage recorded without sending keys to the browser.</li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/ripplemap" className="btn-secondary min-h-8 px-2.5 py-1.5 text-xs">Open RippleMap <ArrowRight className="h-3.5 w-3.5" /></Link>
                <Link to="/docs" className="btn-ghost min-h-8 px-2.5 py-1.5 text-xs">Read documentation</Link>
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="AI workflow usage" description="Calls recorded for this workspace. No repository content is included." />
            {loading ? (
              <LoadingBlock label="Loading AI usage" />
            ) : error ? (
              <p className="px-5 py-4 text-xs text-danger-600">{error}</p>
            ) : usage.length === 0 ? (
              <p className="px-5 py-4 text-xs text-ink-muted">No AI calls recorded for this workspace yet.</p>
            ) : (
              <ul className="divide-y divide-line-faint">
                {usage.map((row) => (
                  <li key={`${row.workflow}-${row.provider}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold text-ink">{titleCase(row.workflow)}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-ink-faint">{row.provider} · {row.model}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold text-ink">{row.calls} calls</p>
                      <p className="mt-0.5 text-[10px] text-ink-faint">{row.degraded} fallback · {formatDateTime(row.last_call)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Integration prerequisites" description="What must exist before repository work is exposed." />
            <ol className="space-y-2 p-5 text-[11px] leading-5 text-ink-muted">
              <li><strong className="text-ink">1.</strong> A reviewed repository provider and OAuth scope model.</li>
              <li><strong className="text-ink">2.</strong> Server-side token storage and webhook signature verification.</li>
              <li><strong className="text-ink">3.</strong> Repository permission mapping that cannot be bypassed through workspace navigation.</li>
              <li><strong className="text-ink">4.</strong> End-to-end tests for revoked access, failed sync and stale repository metadata.</li>
              <li><strong className="text-ink">5.</strong> Audit events for every connection, scope change and code-linked decision.</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
