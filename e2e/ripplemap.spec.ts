import { expect, test } from "@playwright/test";
import { DEMO_EMAIL, signIn } from "./helpers";

test.describe("RippleMap critical decision journey", () => {
  test("simulates an option, approves it, and records an immutable plan version", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });
    await page.goto("/ripplemap");

    const decisionLink = page.locator('main a[href^="/ripplemap/"]').first();
    await expect(decisionLink).toBeVisible({ timeout: 20_000 });
    await decisionLink.click();
    await expect(page.getByRole("heading", { name: "Review change impact" })).toBeVisible();
    await expect(page.getByText("Changing the option runs a new deterministic simulation.")).toBeVisible();

    const simulateButton = page.getByRole("button", { name: /Simulate/ });
    await expect(simulateButton).toBeEnabled();
    await simulateButton.click();

    const approveButton = page.getByRole("button", { name: /Approve accept change/i });
    await expect(approveButton).toBeEnabled({ timeout: 20_000 });
    await page.getByLabel("Approval reason").fill("E2E validation: accept the simulated mitigation and create the reviewed version.");
    await approveButton.click();

    await expect(page.getByText(/Decision approved as/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/New immutable plan version/).first()).toBeVisible();
  });
});
