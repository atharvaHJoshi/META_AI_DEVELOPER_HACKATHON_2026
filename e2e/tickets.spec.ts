import { expect, test } from "@playwright/test";
import { DEMO_EMAIL, signIn } from "./helpers";

test.describe("Ticket inbox journey", () => {
  test("creates a ticket and runs labelled analysis before review", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });
    await page.goto("/tickets/new");

    const projectSelect = page.locator("#ticket-project");
    const projectValue = await projectSelect
      .locator("option")
      .filter({ hasText: "Commerce Platform Relaunch" })
      .first()
      .getAttribute("value");
    await expect(projectValue).toBeTruthy();
    await projectSelect.selectOption({ value: projectValue ?? "" });

    await page.getByLabel(/Title/i).fill("E2E checkout retry duplicate capture");
    await page.getByLabel(/Description/i).fill("E2E incident: checkout retry produced a duplicate capture. The observed transaction evidence is included.");
    await page.getByLabel(/Evidence/i).fill("E2E transaction id pi_e2e and capture webhook idem_e2e.");
    await page.getByRole("button", { name: /Save ticket/i }).click();

    await expect(page).toHaveURL(/\/tickets\/tkt_/, { timeout: 30_000 });
    await expect(page.getByText(/Base plan v\d+/i)).toBeVisible();
  });
});
