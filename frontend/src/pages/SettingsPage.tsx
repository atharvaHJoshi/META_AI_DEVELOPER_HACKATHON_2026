import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Bell,
  CheckCircle2,
  Cpu,
  KeyRound,
  Laptop,
  LogOut,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { AuthSession, NotificationPreference, NotificationPreferenceList } from "@miraiwerk/schemas";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { cn, formatDateTime, relativeTime, titleCase } from "../lib/format";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  StatCard,
  Table,
  Td,
  Th,
} from "../components/ui";

interface AiStatus {
  provider: string;
  model: string;
  usesGemini: boolean;
  usesMeta: boolean;
  fallbackEnabled: boolean;
  label: string;
  geminiConfigured: boolean;
  metaConfigured: boolean;
}

interface Usage {
  usage: Array<{
    workflow: string;
    provider: string;
    model: string;
    calls: number;
    degraded: number;
    input_tokens: number | null;
    output_tokens: number | null;
    last_call: string;
  }>;
}

const NOTIFICATION_CATEGORY_HINTS: Record<string, string> = {
  tasks: "Assignments, due-soon work and overdue tasks.",
  tickets: "New intake that needs triage.",
  decisions: "Proposals ready for review and recorded outcomes.",
  meetings: "Scheduled meetings and agenda updates.",
  discussions: "Replies and @mentions in workspace discussions.",
  milestones: "Approaching milestone targets and release gates.",
  digests: "Periodic workspace summaries.",
  security: "Sign-in, password and account security events.",
};

export function SettingsPage() {
  const { user, updateProfile, logout } = useAuth();
  const { activeWorkspace, activeOrganization, aiMode, role } = useWorkspace();
  const { toast } = useToast();
  const workspaceId = activeWorkspace?.id ?? "";
  const [profile, setProfile] = useState({ name: user?.name ?? "", title: user?.title ?? "", avatarColor: user?.avatarColor ?? "#496A91" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const ai = useAsync<AiStatus>(() => api.ai.status(), []);
  const usage = useAsync<Usage>(() => api.ai.usage(workspaceId), [workspaceId]);
  const sessions = useAsync<{ sessions: AuthSession[] }>(() => api.auth.sessions(), []);
  const health = useAsync(() => api.health(), []);
  const notificationPreferences = useAsync<NotificationPreferenceList>(
    () => api.notifications.preferences(),
    [],
  );
  const [preferenceBusy, setPreferenceBusy] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);

  const updatePreference = async (
    preference: NotificationPreference,
    channel: "inApp" | "email",
    checked: boolean,
  ) => {
    setPreferenceBusy(`${preference.category}:${channel}`);
    setPreferenceError(null);
    try {
      await api.notifications.updatePreferences([
        {
          category: preference.category,
          inApp: channel === "inApp" ? checked : preference.inApp,
          email: channel === "email" ? checked : preference.email,
        },
      ]);
      await notificationPreferences.reload();
      toast("Notification preference saved.", "success");
    } catch (cause) {
      setPreferenceError(
        cause instanceof ApiError ? cause.message : "The notification preference could not be saved.",
      );
    } finally {
      setPreferenceBusy(null);
    }
  };

  useEffect(() => {
    setProfile({ name: user?.name ?? "", title: user?.title ?? "", avatarColor: user?.avatarColor ?? "#496A91" });
  }, [user?.id, user?.name, user?.title, user?.avatarColor]);

  const totalCalls = useMemo(() => (usage.data?.usage ?? []).reduce((sum, row) => sum + row.calls, 0), [usage.data]);
  const fallbackCalls = useMemo(() => (usage.data?.usage ?? []).reduce((sum, row) => sum + row.degraded, 0), [usage.data]);
  const currentSessions = sessions.data?.sessions ?? [];

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingProfile(true);
    setProfileError(null);
    try {
      await updateProfile({
        name: profile.name.trim(),
        title: profile.title.trim(),
        avatarColor: profile.avatarColor,
      });
      toast("Profile updated.", "success");
    } catch (cause) {
      setProfileError(cause instanceof ApiError ? cause.message : "The profile could not be saved.");
    } finally {
      setSavingProfile(false);
    }
  };

  const revoke = async (session: AuthSession) => {
    if (session.current) return;
    setSessionBusy(session.id);
    setSessionError(null);
    try {
      await api.auth.revokeSession(session.id);
      await sessions.reload();
      toast("Session revoked.", "success");
    } catch (cause) {
      setSessionError(cause instanceof ApiError ? cause.message : "The session could not be revoked.");
    } finally {
      setSessionBusy(null);
    }
  };

  if (!user) return null;

  return (
    <div>
      <PageHeader
        eyebrow={`${activeOrganization?.name ?? "Organization"} · ${activeWorkspace?.name ?? "Workspace"}`}
        title="Settings & AI Configuration"
        description="Your account, active sessions and the server-side AI configuration. Provider keys never reach the browser, and no editable key field is offered here."
        actions={<Link to="/organization" className="btn-secondary"><ShieldCheck className="h-4 w-4" /> Workspace administration</Link>}
        meta={
          <>
            <Badge tone={aiMode?.usesGemini ? "sage" : aiMode?.usesMeta ? "primary" : "amber"} dot>{aiMode?.label ?? "AI status"}</Badge>
            <span>Workspace role: {titleCase(role ?? "none")}</span>
            <span>· {activeWorkspace?.id ?? "No workspace"}</span>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="AI provider" value={ai.data?.usesGemini ? "Gemini" : ai.data?.usesMeta ? "Meta" : "Fallback"} hint={ai.data?.model ?? "Loading provider status"} icon={Sparkles} tone={ai.data?.usesGemini ? "sage" : "amber"} />
        <StatCard label="Recorded AI calls" value={totalCalls} hint="All workflows in this workspace" icon={Cpu} tone="primary" />
        <StatCard label="Fallback calls" value={fallbackCalls} hint="Labelled instead of presented as AI" icon={ShieldAlert} tone={fallbackCalls > 0 ? "amber" : "sage"} />
        <StatCard label="Active sessions" value={currentSessions.length} hint="Refresh sessions for your account" icon={Laptop} tone="neutral" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Your profile" description="Shown on decisions, documents and discussion replies." />
            <form onSubmit={saveProfile} className="space-y-4 p-5">
              {profileError && <Alert tone="danger">{profileError}</Alert>}
              <div className="flex items-center gap-4">
                <Avatar name={profile.name || user.name} color={profile.avatarColor} size="lg" />
                <div>
                  <p className="text-sm font-semibold text-ink">{user.email}</p>
                  <p className="mt-0.5 text-[10px] text-ink-faint">User id <span className="font-mono">{user.id}</span> · {titleCase(user.status)}</p>
                  {user.isPlatformAdmin && <Badge tone="primary" className="mt-1">Platform administrator</Badge>}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="profile-name" required>
                  <Input id="profile-name" value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} minLength={2} required />
                </Field>
                <Field label="Title" htmlFor="profile-title">
                  <Input id="profile-title" value={profile.title} onChange={(event) => setProfile({ ...profile, title: event.target.value })} placeholder="Director of Engineering" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Avatar colour" htmlFor="profile-color" hint="Six-digit hex. Used for your avatar across the workspace.">
                  <div className="flex items-center gap-2">
                    <input
                      id="profile-color"
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(profile.avatarColor) ? profile.avatarColor : "#496A91"}
                      onChange={(event) => setProfile({ ...profile, avatarColor: event.target.value })}
                      className="h-9 w-12 cursor-pointer rounded border border-line bg-surface p-0.5"
                    />
                    <Input value={profile.avatarColor} onChange={(event) => setProfile({ ...profile, avatarColor: event.target.value })} className="font-mono" maxLength={7} />
                  </div>
                </Field>
                <Field label="Email address" htmlFor="profile-email" hint="Contact an organization owner to change your sign-in email.">
                  <Input id="profile-email" value={user.email} readOnly className="bg-surface-muted" />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" loading={savingProfile}><Save className="h-3.5 w-3.5" /> Save profile</Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardHeader title="Active sessions" description="Opaque refresh sessions are rotated on use. Revoking a session ends its ability to refresh access." />
            {sessions.loading ? (
              <LoadingBlock label="Loading sessions" />
            ) : sessions.error ? (
              <p className="px-5 py-4 text-xs text-danger-600">{sessions.error}</p>
            ) : (
              <Table>
                <thead><tr><Th>Device</Th><Th>IP address</Th><Th>Last used</Th><Th>Expires</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                <tbody>
                  {currentSessions.map((session) => (
                    <tr key={session.id}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Laptop className="h-3.5 w-3.5 text-ink-faint" />
                          <div>
                            <p className="text-xs font-semibold text-ink">{session.userAgent ? session.userAgent.slice(0, 56) : "Unknown device"}</p>
                            {session.current && <Badge tone="sage">This session</Badge>}
                          </div>
                        </div>
                      </Td>
                      <Td><span className="font-mono text-[10px] text-ink-muted">{session.ipAddress ?? "—"}</span></Td>
                      <Td><span className="text-[10px] text-ink-muted" title={formatDateTime(session.lastUsedAt)}>{relativeTime(session.lastUsedAt)}</span></Td>
                      <Td><span className="text-[10px] text-ink-faint">{formatDateTime(session.expiresAt)}</span></Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={session.current}
                          onClick={() => void revoke(session)}
                          loading={sessionBusy === session.id}
                          aria-label={`Revoke session ${session.id}`}
                          title={session.current ? "Sign out to end this session" : "Revoke session"}
                        >
                          <LogOut className="h-3.5 w-3.5" />
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {sessionError && <div className="border-t border-line px-5 py-3"><Alert tone="danger">{sessionError}</Alert></div>}
            <div className="border-t border-line px-5 py-3">
              <Button variant="ghost" onClick={() => void Promise.all([sessions.reload(), usage.reload()])}>Refresh session list</Button>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="AI configuration"
              description="Configured entirely through server environment variables. The browser receives status, never credentials."
              actions={<Badge tone={ai.data?.usesGemini ? "sage" : "amber"} dot>{ai.data?.usesGemini ? "Primary connected" : ai.data?.usesMeta ? "Meta model" : "Fallback"}</Badge>}
            />
            {ai.loading ? (
              <LoadingBlock label="Loading AI configuration" />
            ) : ai.error ? (
              <p className="px-5 py-4 text-xs text-danger-600">{ai.error}</p>
            ) : ai.data ? (
              <div className="space-y-3 p-5">
                <div className="rounded-md border border-line bg-surface-muted p-3">
                  <p className="text-[10px] font-semibold text-ink">{ai.data.label}</p>
                  <p className="mt-1 font-mono text-[10px] text-ink-muted">{ai.data.provider} · {ai.data.model}</p>
                </div>
                <ul className="space-y-2">
                  <ConfigRow
                    label="Gemini API key"
                    configured={ai.data.geminiConfigured}
                    detail={ai.data.geminiConfigured ? "GEMINI_API_KEY or GOOGLE_AI_API_KEY is set on the server." : "Not configured; requests use the labelled deterministic fallback."}
                  />
                  <ConfigRow
                    label="Meta app credentials"
                    configured={ai.data.metaConfigured}
                    detail={ai.data.metaConfigured ? "META_APP_ID and META_APP_SECRET are configured for OAuth." : "Meta sign-in is unavailable until both app credentials are set."}
                  />
                  <ConfigRow
                    label="Deterministic fallback"
                    configured={ai.data.fallbackEnabled}
                    detail="Always available for planning, analysis and assistant workflows, labelled in the UI and audit data."
                    tone="amber"
                  />
                </ul>
                <Alert tone="info" title="Where to change this">
                  Set <span className="font-mono text-[10px]">GEMINI_API_KEY</span>, <span className="font-mono text-[10px]">AI_PROVIDER</span>,
                  <span className="font-mono text-[10px]"> META_APP_ID</span> and <span className="font-mono text-[10px]">META_APP_SECRET</span> in the backend
                  environment, then restart the API. Keys are never accepted through this page.
                </Alert>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="System health" description="Live API readiness, not a cached marketing badge." />
            <div className="space-y-3 p-5">
              {health.loading ? <LoadingBlock label="Checking API health" /> : health.error ? (
                <Alert tone="danger" title="API health check failed">{health.error}</Alert>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
                    <div>
                      <p className="text-xs font-semibold text-ink">API</p>
                      <p className="mt-0.5 text-[10px] text-ink-faint">Checked {health.data ? formatDateTime(health.data.time) : "—"}</p>
                    </div>
                    <Badge tone={health.data?.status === "ok" ? "sage" : "danger"} dot>{health.data?.status ?? "unknown"}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
                    <div>
                      <p className="text-xs font-semibold text-ink">AI mode</p>
                      <p className="mt-0.5 text-[10px] text-ink-faint">{health.data?.aiLabel ?? "Unknown"}</p>
                    </div>
                    <Activity className="h-4 w-4 text-primary-500" />
                  </div>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Link to="/ai/plan" className="btn-secondary min-h-8 px-2.5 py-1.5 text-xs"><Sparkles className="h-3.5 w-3.5" /> Test via plan generation</Link>
                <Button size="sm" variant="ghost" onClick={() => { void ai.reload(); void health.reload(); }}>Refresh status</Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="AI usage" description="Per-workflow call counts. Fallback calls are counted separately." />
            {usage.loading ? (
              <LoadingBlock label="Loading usage" />
            ) : usage.error ? (
              <p className="px-5 py-4 text-xs text-danger-600">{usage.error}</p>
            ) : (usage.data?.usage.length ?? 0) === 0 ? (
              <EmptyState icon={Cpu} title="No AI calls yet" description="Usage is recorded after a plan, analysis or assistant request." compact />
            ) : (
              <ul className="divide-y divide-line-faint">
                {usage.data?.usage.map((row) => (
                  <li key={`${row.workflow}-${row.provider}`} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-ink">{titleCase(row.workflow)}</p>
                      <Badge tone={row.degraded > 0 ? "amber" : "sage"}>{row.calls} calls</Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-[9px] text-ink-faint">{row.provider} · {row.model} · {row.degraded} fallback · last {relativeTime(row.last_call)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Notifications"
              description="Choose which events create in-app alerts and email. Security alerts are always enabled."
              actions={<Badge tone="primary" dot>Per account</Badge>}
            />
            {notificationPreferences.loading ? (
              <LoadingBlock label="Loading notification preferences" />
            ) : notificationPreferences.error ? (
              <p className="px-5 py-4 text-xs text-danger-600">{notificationPreferences.error}</p>
            ) : (notificationPreferences.data?.preferences.length ?? 0) === 0 ? (
              <EmptyState icon={Bell} title="No categories available" compact />
            ) : (
              <>
                {preferenceError && (
                  <div className="border-b border-line px-5 py-3">
                    <Alert tone="danger">{preferenceError}</Alert>
                  </div>
                )}
                <ul className="divide-y divide-line-faint">
                  {notificationPreferences.data?.preferences.map((preference) => (
                    <li key={preference.category} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-ink">{titleCase(preference.category)}</p>
                          {preference.locked && <Badge tone="sage">Always on</Badge>}
                        </div>
                        <p className="mt-0.5 text-[10px] leading-4 text-ink-faint">
                          {NOTIFICATION_CATEGORY_HINTS[preference.category] ?? "Workspace activity updates."}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <Checkbox
                          label="In-app"
                          checked={preference.inApp}
                          disabled={preference.locked || preferenceBusy !== null}
                          onChange={(event) =>
                            void updatePreference(preference, "inApp", event.target.checked)
                          }
                        />
                        <Checkbox
                          label="Email"
                          checked={preference.email}
                          disabled={preference.locked || preferenceBusy !== null}
                          onChange={(event) =>
                            void updatePreference(preference, "email", event.target.checked)
                          }
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card>
            <CardHeader title="Security and data" description="What this build does and does not implement." />
            <ul className="space-y-2 p-5 text-[11px] leading-5 text-ink-muted">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage-500" /> Passwords use Argon2id with a scrypt fallback; refresh tokens are opaque, hashed and rotated.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage-500" /> Tenant access is checked server-side against organization, workspace and project membership.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage-500" /> Shared PostgreSQL fixed-window limits cover sign-in, registration, password reset, session refresh and AI workflows.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage-500" /> Notification preferences and transactional email delivery are implemented; delivery attempts are recorded for operators.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage-500" /> Security, project and decision audit rows are append-only at the database level; the admin console is read-only for them.</li>
              <li className="flex gap-2"><ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-500" /> Production startup rejects development secrets, wildcard hosts, insecure cookies, disabled HTTPS redirects and the console email backend.</li>
              <li className="flex gap-2"><KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-500" /> AI and Meta keys belong in server environment configuration, never browser storage.</li>
            </ul>
            <div className="border-t border-line px-5 py-3">
              <Button variant="ghost" onClick={() => void logout()}><LogOut className="h-3.5 w-3.5" /> Sign out</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, configured, detail, tone }: { label: string; configured: boolean; detail: string; tone?: "amber" }) {
  return (
    <li className={cn("rounded-md border px-3 py-2.5", configured ? "border-sage-100 bg-sage-50" : "border-line bg-surface-muted")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-ink">{label}</p>
        <Badge tone={configured ? (tone === "amber" ? "amber" : "sage") : "neutral"} dot>{configured ? "Configured" : "Not configured"}</Badge>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-ink-muted">{detail}</p>
    </li>
  );
}
