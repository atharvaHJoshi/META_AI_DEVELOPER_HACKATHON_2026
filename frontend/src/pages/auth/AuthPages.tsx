import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  GitCompareArrows,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { AuthResponse } from "@miraiwerk/schemas";
import { useAuth } from "../../context/AuthContext";
import { api, ApiError, setAccessToken } from "../../lib/api";
import { Alert, Button, Field, Input, Spinner } from "../../components/ui";

const DEMO_USERS = [
  { email: "maya.chen@miraiwerk.demo", name: "Maya Chen", role: "Owner" },
  { email: "arjun.patel@miraiwerk.demo", name: "Arjun Patel", role: "Manager" },
  { email: "lena.ortiz@miraiwerk.demo", name: "Lena Ortiz", role: "Member" },
  { email: "priya.shah@miraiwerk.demo", name: "Priya Shah", role: "Viewer" },
];

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto grid min-h-screen max-w-[1280px] lg:grid-cols-[1.05fr_1fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface px-10 py-10 lg:flex xl:px-14">
          <div className="absolute inset-0 opacity-[0.55]" aria-hidden>
            <div className="absolute -right-24 top-16 h-72 w-72 rounded-full border border-primary-100" />
            <div className="absolute -right-10 top-40 h-52 w-52 rounded-full border border-primary-100" />
            <div className="absolute bottom-10 left-10 h-40 w-40 rounded-full bg-primary-50" />
          </div>
          <div className="relative">
            <Link to="/login" className="inline-flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500 text-xs font-bold text-white">
                MW
              </span>
              <span>
                <span className="block text-sm font-bold tracking-tight text-ink">MIRAIWERK AI</span>
                <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
                  Change intelligence
                </span>
              </span>
            </Link>
            <div className="mt-16 max-w-lg">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary-600">
                Project delivery, with evidence
              </p>
              <h1 className="mt-4 text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink">
                See the ripple before you approve the change.
              </h1>
              <p className="mt-5 max-w-md text-sm leading-7 text-ink-muted">
                Tickets, plans, dependencies, capacity and milestones in one workspace. RippleMap
                simulates the impact deterministically; a human makes the decision.
              </p>
            </div>
            <div className="mt-10 grid max-w-lg gap-3">
              {[
                {
                  icon: GitCompareArrows,
                  title: "Before / after, never guessed",
                  text: "Added, changed, blocked and removed work is labelled observed, inferred or unknown.",
                },
                {
                  icon: ShieldCheck,
                  title: "Human approval and immutable history",
                  text: "Plan versions are created only after an authorized decision. The audit trail stays intact.",
                },
                {
                  icon: Sparkles,
                  title: "Gemini with a transparent fallback",
                  text: "AI drafts and analyses are labelled. When Gemini is unavailable, deterministic rules say so.",
                },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-3 rounded-lg border border-line bg-surface/90 p-3.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-600">
                    <item.icon className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-ink-muted">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="relative text-[10px] leading-5 text-ink-faint">
            Built for teams that need to explain a schedule change, not just publish one.
          </p>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center gap-2 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-500 text-[10px] font-bold text-white">
                MW
              </span>
              <span className="text-sm font-bold text-ink">MIRAIWERK AI</span>
            </div>
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}

function MetaButton() {
  const [status, setStatus] = useState<{ configured: boolean; label: string } | null>(null);
  useEffect(() => {
    void api.auth
      .oauthStatus()
      .then((result) => setStatus(result.meta))
      .catch(() => setStatus({ configured: false, label: "Continue with Meta" }));
  }, []);

  const start = () => {
    window.location.href = "/api/auth/oauth/meta/start?returnTo=/";
  };

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={!status?.configured}
        className="btn-secondary w-full justify-center"
        title={
          status?.configured
            ? "Sign in with Meta"
            : "Meta sign-in is not configured on this server. Set META_APP_ID and META_APP_SECRET."
        }
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1877F2] text-[9px] font-bold text-white">
          f
        </span>
        Continue with Meta
      </button>
      {!status?.configured && (
        <p className="mt-1.5 text-center text-[10px] text-ink-faint">
          Meta OAuth is available once META_APP_ID and META_APP_SECRET are configured.
        </p>
      )}
    </div>
  );
}

export function LoginPage() {
  const { login, demoLogin } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("maya.chen@miraiwerk.demo");
  const [password, setPassword] = useState("Miraiwerk!2026");
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const oauthError = params.get("oauth_error");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const demo = async (demoEmail: string) => {
    setDemoBusy(demoEmail);
    setError(null);
    try {
      await demoLogin(demoEmail);
      navigate("/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Demo sign-in failed.");
    } finally {
      setDemoBusy(null);
    }
  };

  return (
    <AuthLayout>
      <div className="rounded-xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary-600">Welcome back</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Sign in to your workspace</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Use your organization account, or enter a seeded demo identity.
        </p>

        {oauthError && (
          <div className="mt-4">
            <Alert tone="danger" title="Meta sign-in did not complete">
              {oauthError}
            </Alert>
          </div>
        )}

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <Field label="Email address" htmlFor="email" required>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="password" required>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          {error && (
            <Alert tone="danger" title="Could not sign in">
              {error}
            </Alert>
          )}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Sign in <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-faint">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <MetaButton />

        <div className="mt-6 rounded-lg border border-line bg-surface-muted p-3.5">
          <p className="text-xs font-semibold text-ink">Demo identities</p>
          <p className="mt-0.5 text-[11px] leading-5 text-ink-muted">
            Password for all seeded accounts: <span className="font-mono">Miraiwerk!2026</span>
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            {DEMO_USERS.map((user) => (
              <button
                key={user.email}
                type="button"
                onClick={() => void demo(user.email)}
                disabled={demoBusy !== null}
                className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-left text-[11px] text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-muted disabled:opacity-60"
              >
                {demoBusy === user.email ? <Spinner className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3 text-ink-faint" />}
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{user.name}</span>
                  <span className="block text-[9px] text-ink-faint">{user.role}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-ink-muted">
          New to MIRAIWERK?{" "}
          <Link to="/register" className="font-semibold text-primary-600 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    organizationName: "",
    password: "",
    confirm: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordIssue = useMemo(() => {
    if (!form.password) return null;
    if (form.password.length < 10) return "Use at least 10 characters.";
    if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      return "Include at least one letter and one number.";
    }
    return null;
  }, [form.password]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (passwordIssue) {
      setError(passwordIssue);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        organizationName: form.organizationName.trim() || undefined,
      });
      navigate("/onboarding");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Account creation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="rounded-xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary-600">Get started</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Create your workspace</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Start with an organization and a first workspace. You can invite the team next.
        </p>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <Field label="Full name" htmlFor="fullName" required>
            <Input
              id="fullName"
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              autoComplete="name"
              required
            />
          </Field>
          <Field label="Work email" htmlFor="email" required>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              autoComplete="email"
              required
            />
          </Field>
          <Field
            label="Organization name"
            htmlFor="organizationName"
            hint="Optional. We create a personal workspace if you skip this."
          >
            <Input
              id="organizationName"
              value={form.organizationName}
              onChange={(event) => setForm({ ...form, organizationName: event.target.value })}
              autoComplete="organization"
            />
          </Field>
          <Field label="Password" htmlFor="password" required error={passwordIssue}>
            <Input
              id="password"
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" required>
            <Input
              id="confirm"
              type="password"
              value={form.confirm}
              onChange={(event) => setForm({ ...form, confirm: event.target.value })}
              autoComplete="new-password"
              required
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Create account <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        <div className="mt-5 flex items-start gap-2 rounded-md border border-line bg-surface-muted p-3 text-[11px] leading-5 text-ink-muted">
          <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Passwords are hashed with Argon2id. Sessions use short-lived access tokens and rotating
          refresh tokens stored in an httpOnly cookie.
        </div>

        <p className="mt-6 text-center text-xs text-ink-muted">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-primary-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

export function OAuthCallbackPage() {
  const { retry } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();

  useEffect(() => {
    let cancelled = false;
    const complete = async () => {
      try {
        const result: AuthResponse | null = await api.auth.refresh();
        if (!result) throw new Error("The OAuth session could not be established.");
        if (cancelled) return;
        setAccessToken(result.accessToken);
        await retry();
        const returnTo = params.get("returnTo") ?? "/";
        navigate(returnTo.startsWith("/") ? returnTo : "/", { replace: true });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "OAuth sign-in failed.");
      }
    };
    void complete();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthLayout>
      <div className="rounded-xl border border-line bg-surface p-8 text-center shadow-card">
        {error ? (
          <>
            <Mail className="mx-auto h-8 w-8 text-danger-500" />
            <h1 className="mt-3 text-lg font-semibold text-ink">Sign-in could not complete</h1>
            <p className="mt-1 text-sm text-ink-muted">{error}</p>
            <Link to="/login" className="btn-primary mt-5 inline-flex">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-500" />
            <h1 className="mt-3 text-lg font-semibold text-ink">Completing Meta sign-in</h1>
            <p className="mt-1 text-sm text-ink-muted">Establishing a secure session and loading your workspace…</p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
