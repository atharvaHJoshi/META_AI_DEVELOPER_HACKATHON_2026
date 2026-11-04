import { expect, test } from "@playwright/test";
import { DEMO_EMAIL, DEMO_PASSWORD, signIn } from "./helpers";

test.describe("MIRAIWERK access and keyboard", () => {
  test.describe("unauthenticated visitors", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("sends unauthenticated visitors to the sign-in screen", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
    });

    test("rejects an unknown seeded email with a visible failure state", async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Email address").fill("nobody@example.invalid");
      await page.getByLabel("Password").fill(DEMO_PASSWORD);
      await page.getByRole("button", { name: /Sign in/ }).click();

      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("alert")).toContainText(/could not sign in|sign/i);
    });
  });

  test("signs in to the workspace and exposes the primary destinations", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });

    for (const label of [
      "Overview",
      "Projects",
      "Tasks & Sprints",
      "Roadmaps & Milestones",
      "Teams & Workload",
      "AI Plan Generator",
      "Ticket Inbox",
      "RippleMap",
      "Decision & Plan History",
      "Documentation & Diagrams",
      "Meetings",
      "Code Workspace",
      "Discussions",
      "Organization & Workspaces",
      "Roles & Permissions",
      "Audit Logs",
      "Settings & AI",
    ]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("supports the primary keyboard route into the workspace content", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /Skip to main content/i })).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/(?!login|signup)/);
  });
});
