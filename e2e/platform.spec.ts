import { expect, test } from "@playwright/test";
import { DEMO_EMAIL, signIn } from "./helpers";

test.describe("Roles, permissions and AI configuration", () => {
  test("enforces read-only visibility for viewer roles", async ({ page }) => {
    await signIn(page, "priya.shah@miraiwerk.demo");
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });

    await page.goto("/tasks");
    await expect(page.getByText("Move work through a permission-aware Kanban board.")).toBeVisible();
    await expect(page.getByRole("button", { name: /New task/i })).toHaveCount(0);

    await page.goto("/ripplemap");
    await expect(page.getByRole("heading", { name: /RippleMap|Decision|Review change impact/i })).toBeVisible({ timeout: 20_000 });

    for (const route of ["/organization", "/roles", "/audit"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: "You do not have access to this page" })).toBeVisible({ timeout: 15_000 });
    }

    await page.goto("/settings");
    await expect(page.getByText(/Provider keys never reach the browser/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel(/Gemini API key/i)).toHaveCount(0);
    await expect(page.getByLabel(/Meta app credentials/i)).toHaveCount(0);
  });

  test("keeps the owner able to review AI status and usage", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });
    await page.goto("/settings");

    await expect(page.getByText("AI provider")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Server-side AI configuration")).toBeVisible();
  });
});
