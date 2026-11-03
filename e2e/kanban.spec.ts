import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("Kanban board coverage", () => {
  test("renders the permission-aware task board columns", async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });
    await page.goto("/tasks");

    await expect(page.getByRole("heading", { name: "Planned" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "In progress" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Blocked" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
  });
});
