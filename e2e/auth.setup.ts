import { expect, test as setup } from "@playwright/test";
import { DEMO_EMAIL, DEMO_PASSWORD } from "./helpers";

const authFile = "e2e/.auth/maya.json";

setup("authenticate the demo owner once", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();

  await page.getByLabel("Email address").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /Sign in/ }).click();

  await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({
    timeout: 25_000,
  });
  await page.context().storageState({ path: authFile });
});
