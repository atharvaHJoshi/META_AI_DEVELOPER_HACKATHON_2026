import { expect, type Page } from "@playwright/test";

export const DEMO_EMAIL = "maya.chen@miraiwerk.demo";
export const DEMO_PASSWORD = "Miraiwerk!2026";
export const VIEWER_EMAIL = "priya.shah@miraiwerk.demo";

export async function signIn(page: Page, email: string = DEMO_EMAIL): Promise<void> {
  const greeting = page.getByText(/Good (morning|afternoon|evening),/);
  const emailField = page.getByLabel("Email address");

  if (email === DEMO_EMAIL) {
    // The saved storage state normally lands directly in the workspace. When
    // it is absent the app redirects to /login after hydration, so wait for
    // either outcome instead of checking the URL before React has rendered.
    await page.goto("/");
    await expect(greeting.or(emailField)).toBeVisible({ timeout: 20_000 });
    if (await greeting.isVisible()) return;
  } else {
    // The default browser context is authenticated as the demo owner. Clear
    // both the access token and refresh cookie before switching identities.
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
    await page.context().clearCookies();
  }

  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /Sign in/ }).click();
}

export async function createPendingDecision(page: Page): Promise<string> {
  const session = await page.evaluate(() => ({
    token: window.localStorage.getItem("miraiwerk.access_token"),
    workspaceId: window.localStorage.getItem("miraiwerk.workspace_id"),
  }));
  if (!session.token) throw new Error("No access token is available for API setup.");

  const apiBase = process.env.E2E_API_URL ?? "http://localhost:4000/api";
  const headers = {
    Authorization: `Bearer ${session.token}`,
    "x-workspace-id": session.workspaceId ?? "",
  };

  const projectsResponse = await page.request.get(`${apiBase}/projects`, { headers });
  expect(projectsResponse.ok()).toBeTruthy();
  const projects = (await projectsResponse.json()).projects as Array<{
    id: string;
    name: string;
  }>;
  const project =
    projects.find((item) => item.name === "Commerce Platform Relaunch") ?? projects[0];
  if (!project) throw new Error("No project is available for the RippleMap setup.");

  const suffix = Date.now();
  const ticketResponse = await page.request.post(`${apiBase}/tickets`, {
    headers,
    data: {
      projectId: project.id,
      title: `E2E RippleMap decision ${suffix}`,
      description:
        "E2E incident: checkout retry produced a duplicate capture. The observed transaction evidence is included.",
      evidence: `E2E transaction pi_${suffix} and capture webhook idem_${suffix}.`,
      ticketType: "incident",
    },
  });
  expect(ticketResponse.ok()).toBeTruthy();
  const ticketId = (await ticketResponse.json()).ticket.id as string;

  const analysisResponse = await page.request.post(
    `${apiBase}/tickets/${ticketId}/analyze`,
    { headers, data: {} },
  );
  expect(analysisResponse.ok()).toBeTruthy();
  return (await analysisResponse.json()).proposal.id as string;
}

export async function expectWorkspace(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/(?!login|signup)/);
  await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 20_000 });
}
