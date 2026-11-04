import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("Mermaid documentation diagrams", () => {
  test("renders diagram source live and reports syntax errors", async ({ page }) => {
    await signIn(page);
    await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 25_000 });
    await page.goto("/docs");

    await page.getByRole("button", { name: /New document/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Title/i).fill("E2E Mermaid diagram");
    await dialog.getByLabel(/^Type/i).selectOption("diagram");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden();

    const source = page.getByLabel(/Diagram source/i);
    const preview = page.getByTestId("mermaid-preview");
    await expect(source).toBeVisible();
    await expect(preview).toHaveAttribute("data-state", "empty");

    await source.fill(
      "graph TD\n  ticket[Ticket evidence] --> proposal[Decision proposal]\n  proposal --> approval{Human approval}",
    );
    await expect(preview).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(preview.getByTestId("mermaid-diagram").locator("svg")).toBeVisible();
    await expect(preview.getByText("Ticket evidence")).toBeVisible();
    // The application's `.label` eyebrow utility must not leak into Mermaid's
    // own `.label` groups and force diagram text into tiny uppercase mono.
    await expect(preview.locator(".node .label").first()).toHaveCSS("text-transform", "none");

    await source.fill("graph TD\n  ticket -->");
    await expect(preview).toHaveAttribute("data-state", "error", { timeout: 30_000 });
    await expect(preview.getByText("Diagram syntax error")).toBeVisible();
    await expect(preview.getByTestId("mermaid-diagram")).toHaveCount(0);

    await source.fill(
      "sequenceDiagram\n  participant Maya as Product owner\n  participant API as MIRAIWERK API\n  Maya->>API: Approve plan\n  API-->>Maya: Immutable version",
    );
    await expect(preview).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(preview.getByTestId("mermaid-diagram").locator("svg")).toBeVisible();
    await expect(preview.getByText("Approve plan")).toBeVisible();

    await page.getByRole("button", { name: "Delete E2E Mermaid diagram" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByText("Document deleted.")).toBeVisible();
  });
});
