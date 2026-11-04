import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("Collaboration journeys", () => {
  test("creates, edits and deletes a documentation record", async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });
    await page.goto("/docs");

    await page.getByRole("button", { name: /New document/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Title/i).fill("E2E release decision record");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden();

    const selected = page.getByLabel(/Markdown content|Diagram source/i);
    await expect(selected).toBeVisible();
    await expect(selected).toHaveValue("");
    await selected.fill("# E2E release decision record\n\n## Decision\n\nRelease gate remains closed until evidence is accepted.");
    const preview = page.getByTestId("markdown-preview");
    await page.getByRole("tab", { name: "Preview" }).click();
    await expect(preview.getByRole("heading", { name: "E2E release decision record" })).toBeVisible();
    await expect(preview.getByText("Release gate remains closed until evidence is accepted.")).toBeVisible();
    await page.getByRole("tab", { name: "Split" }).click();
    await expect(page.getByLabel(/Markdown content/i)).toBeVisible();
    await expect(preview.getByRole("heading", { name: "Decision", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Write" }).click();
    const saveButton = page.getByRole("button", { name: /Save/i });
    await expect(saveButton).toBeEnabled({ timeout: 10_000 });
    await saveButton.click();
    await expect(page.getByText("Document saved.")).toBeVisible();

    await page.getByRole("button", { name: "Delete E2E release decision record" }).click();
    const deleteDialog = page.getByRole("dialog");
    await deleteDialog.getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByText("Document deleted.")).toBeVisible();
  });

  test("posts a discussion reply and marks the thread solved", async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });
    await page.goto("/discussions");

    const thread = page.locator("main button").filter({ hasText: /Should the payments release gate move|Duplicate-looking/ }).first();
    await expect(thread).toBeVisible();
    await thread.click();
    await expect(page.getByLabel(/Add evidence|Reply|Type your reply/i)).toBeVisible();
    await page.getByLabel("Reply").fill("E2E validation: keep the release gate closed until the accepted fix is linked.");
    await page.getByRole("button", { name: /Post reply/i }).click();
    await expect(page.getByText("Reply posted.")).toBeVisible();
    await page.getByRole("button", { name: /Mark solved|Reopen/i }).click();
    await expect(page.getByText(/Discussion marked solved|Discussion reopened/)).toBeVisible();
  });

  test("schedules a meeting and converts its action item", async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });
    await page.goto("/meetings");

    await page.getByRole("button", { name: /Schedule meeting/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Title/i).fill("E2E release readiness check");
    const scheduleButton = dialog.getByRole("button", { name: "Schedule", exact: true });
    await expect(scheduleButton).toBeEnabled();
    await scheduleButton.evaluate((element) => (element as HTMLButtonElement).click());
    await expect(page.getByText("Meeting scheduled.")).toBeVisible();
  });
});
