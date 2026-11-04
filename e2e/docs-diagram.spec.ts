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

    // Desktop uses a contained split-pane editor: source and preview sit side
    // by side at lg+, share the same 60vh height, and scroll inside their own
    // panes instead of making the whole page taller.
    const desktopLayout = await page.evaluate(() => {
      const sourceRect = document.getElementById("doc-content")?.getBoundingClientRect();
      const previewRect = document.querySelector('[data-testid="mermaid-preview"]')?.getBoundingClientRect();
      return {
        sideBySide: Boolean(sourceRect && previewRect && previewRect.left >= sourceRect.right - 1),
        sourceHeight: Math.round(sourceRect?.height ?? 0),
        previewHeight: Math.round(previewRect?.height ?? 0),
        previewWidth: Math.round(previewRect?.width ?? 0),
      };
    });
    expect(desktopLayout.sideBySide).toBe(true);
    expect(Math.abs(desktopLayout.sourceHeight - desktopLayout.previewHeight)).toBeLessThanOrEqual(2);
    expect(desktopLayout.previewWidth).toBeGreaterThan(320);

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(preview).toBeVisible();
    // The viewport resize triggers a layout pass; wait for it to settle before
    // measuring so transient desktop-width overflow is not reported.
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);
    const mobileLayout = await page.evaluate(() => {
      const sourceRect = document.getElementById("doc-content")?.getBoundingClientRect();
      const previewRect = document.querySelector('[data-testid="mermaid-preview"]')?.getBoundingClientRect();
      return {
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        stacked: Boolean(sourceRect && previewRect && previewRect.top >= sourceRect.bottom),
        previewWidth: previewRect?.width ?? 0,
      };
    });
    expect(mobileLayout.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(mobileLayout.stacked).toBe(true);
    expect(mobileLayout.previewWidth).toBeLessThanOrEqual(375);
    await expect(preview.getByTestId("mermaid-diagram").locator("svg")).toBeVisible();

    await page.getByRole("button", { name: "Delete E2E Mermaid diagram" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete document" }).click();
    await expect(page.getByText("Document deleted.")).toBeVisible();
  });
});
