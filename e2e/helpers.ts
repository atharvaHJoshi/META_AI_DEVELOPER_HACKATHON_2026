import { expect, type Page } from "@playwright/test";

export const DEMO_EMAIL = "maya.chen@miraiwerk.demo";
export const DEMO_PASSWORD = "Miraiwerk!2026";
export const VIEWER_EMAIL = "priya.shah@miraiwerk.demo";

export async function signIn(page: Page, email: string = DEMO_EMAIL): Promise<void> {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: /Sign in/ }).click();
}

export async function expectWorkspace(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/(?!login|signup)/);
  await expect(page.getByText(/Good (morning|afternoon|evening),/)).toBeVisible({ timeout: 20_000 });
}
