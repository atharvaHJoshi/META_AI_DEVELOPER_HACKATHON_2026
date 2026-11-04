import { useEffect } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { LockKeyhole } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { TooltipProvider, Button, EmptyState, PageHeader, Spinner } from "./components/ui";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { WorkspaceProvider, useWorkspace } from "./context/WorkspaceContext";
import { hasRole, roleLabel } from "./lib/format";
import { AIPlanGeneratorPage } from "./pages/AIPlanGeneratorPage";
import { AuditPage } from "./pages/AuditPage";
import { CodeWorkspacePage } from "./pages/CodeWorkspacePage";
import { DiscussionsPage } from "./pages/DiscussionsPage";
import { DocsPage } from "./pages/DocsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { MeetingsPage } from "./pages/MeetingsPage";
import { NewTicketPage } from "./pages/NewTicketPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ProjectWorkspacePage } from "./pages/ProjectWorkspacePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RippleMapPage } from "./pages/RippleMapPage";
import { RoadmapPage } from "./pages/RoadmapPage";
import { RolesPage } from "./pages/RolesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { TeamsPage } from "./pages/TeamsPage";
import { TicketDetailPage } from "./pages/TicketDetailPage";
import { TicketsPage } from "./pages/TicketsPage";
import { LoginPage, ForgotPasswordPage, OAuthCallbackPage, RegisterPage, ResetPasswordPage } from "./pages/auth/AuthPages";

function FullPageLoader({ label = "Restoring your workspace" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500 text-xs font-bold text-white">MW</span>
        <p className="flex items-center gap-2 text-sm text-ink-muted"><Spinner /> {label}…</p>
      </div>
    </div>
  );
}

function PublicOnly() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader label="Checking your session" />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <Outlet />;
}

function AppShellLayout() {
  return (
    <WorkspaceProvider>
      <TooltipProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </TooltipProvider>
    </WorkspaceProvider>
  );
}

function OnboardingLayout() {
  return (
    <WorkspaceProvider>
      <div className="min-h-screen bg-canvas">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link to="/" className="flex items-center gap-2.5" aria-label="MIRAIWERK AI home">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-500 text-[10px] font-bold text-white">MW</span>
              <span className="text-sm font-bold tracking-tight text-ink">MIRAIWERK</span>
            </Link>
            <Link to="/" className="btn-ghost min-h-8 px-2.5 py-1.5 text-xs">Return to workspace</Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6"><Outlet /></main>
      </div>
    </WorkspaceProvider>
  );
}

function RoleGate({ minimum, children }: { minimum: "member" | "manager" | "admin"; children: React.ReactNode }) {
  const { role, loading, activeWorkspace } = useWorkspace();
  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-ink-muted"><Spinner /> Checking workspace access…</div>;
  if (!hasRole(role, minimum)) {
    return (
      <div>
        <PageHeader
          eyebrow={activeWorkspace?.name}
          title="You do not have access to this page"
          description="Navigation visibility is not an authorization control. The API enforces the same rule and rejected this route before any data was loaded."
        />
        <div className="app-card p-6">
          <EmptyState
            icon={LockKeyhole}
            title={`${roleLabel(minimum)} access required`}
            description={`Your effective workspace role is ${roleLabel(role)}. Ask an organization owner to review your role if you need access.`}
            action={<Link to="/" className="btn-primary">Return to overview</Link>}
          />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="app-card w-full max-w-lg p-8 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary-600">404</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">This route is not on the plan</h1>
        <p className="mt-1.5 text-sm leading-6 text-ink-muted">
          The page may have moved, or the project link is no longer valid.
        </p>
        <Link to="/" className="btn-primary mt-5 inline-flex">Back to overview</Link>
      </div>
    </div>
  );
}

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname, location.search]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ScrollToTop />
          <Routes>
            <Route path="/auth/callback" element={<OAuthCallbackPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
            </Route>

            <Route element={<RequireAuth />}>
              <Route element={<OnboardingLayout />}>
                <Route path="/onboarding" element={<OnboardingPage />} />
              </Route>

              <Route element={<AppShellLayout />}>
                <Route index element={<OverviewPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/new" element={<Navigate to="/ai/plan" replace />} />
                <Route path="/projects/:projectId" element={<ProjectWorkspacePage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/roadmap" element={<RoadmapPage />} />
                <Route path="/teams" element={<TeamsPage />} />
                <Route path="/ai/plan" element={<AIPlanGeneratorPage />} />
                <Route path="/tickets" element={<TicketsPage />} />
                <Route path="/tickets/new" element={<NewTicketPage />} />
                <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
                <Route path="/ripplemap" element={<RippleMapPage />} />
                <Route path="/ripplemap/:decisionId" element={<RippleMapPage />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/docs" element={<DocsPage />} />
                <Route path="/meetings" element={<MeetingsPage />} />
                <Route path="/code" element={<CodeWorkspacePage />} />
                <Route path="/discussions" element={<DiscussionsPage />} />
                <Route path="/organization" element={<RoleGate minimum="manager"><OrganizationPage /></RoleGate>} />
                <Route path="/roles" element={<RoleGate minimum="admin"><RolesPage /></RoleGate>} />
                <Route path="/audit" element={<RoleGate minimum="admin"><AuditPage /></RoleGate>} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
