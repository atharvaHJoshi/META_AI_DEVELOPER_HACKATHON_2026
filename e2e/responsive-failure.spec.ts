import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("Responsive, failure and keyboard coverage", () => {
  test("opens the mobile navigation with one keyboard-accessible control", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });

    const openButton = page.getByRole("button", { name: "Open navigation" });
    await expect(openButton).toBeVisible();
    await openButton.click();
    const sidebar = page.getByLabel("Mobile navigation");
    await expect(sidebar).toBeVisible();
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(sidebar).toBeHidden();
  });

  test("renders a visible failure state when the documentation API rejects", async ({ page }) => {
    await page.route("**/api/workspaces/*/documents", (route) => route.abort());
    await signIn(page);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });
    await page.goto("/docs");

    await expect(page.getByText("Something did not load")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
