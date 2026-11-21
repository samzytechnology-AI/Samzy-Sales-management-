import { expect, test } from "@playwright/test";

test("all primary navigation controls open their corresponding workspace views", async ({ page }) => {
  await page.goto("/");
  const sections = [
    "Overview",
    "AI General Manager",
    "Leads & CRM",
    "Clients",
    "Projects",
    "Product Registry",
    "Sales & Outreach",
    "Approvals",
    "Finance",
    "Settings",
  ];

  for (const section of sections) {
    await page.getByRole("button", { name: new RegExp(section) }).first().click();
    await expect(page.locator(".crumb")).toContainText(section);
    if (section !== "Overview" && section !== "AI General Manager") {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
    }
  }
});

test("dashboard call-to-action opens the AI General Manager", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Talk to AI Manager/ }).click();
  await expect(page.getByRole("heading", { name: "Talk to your AI General Manager" })).toBeVisible();
});

test("quick commands execute through the chat flow and do not pretend to run offline", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Research new prospects/ }).click();
  await expect(page.locator(".crumb")).toContainText("AI General Manager");
  await expect(page.locator(".messages")).toContainText("Research new Nigerian businesses");
  await expect(page.locator(".messages")).toContainText("secure company workspace is not connected");
});

test("suggested prompt buttons submit a chat prompt", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Talk to AI Manager/ }).click();
  await page.getByRole("button", { name: /Give me a complete briefing/ }).click();
  await expect(page.locator(".messages")).toContainText("Give me a complete briefing on the company.");
  await expect(page.locator(".messages")).toContainText("secure company workspace is not connected");
});

test("chat composer accepts text and reports the disconnected workspace honestly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Talk to AI Manager/ }).click();
  await page.getByPlaceholder(/Ask your AI General Manager anything/).fill("Summarise today's company operations.");
  await page.getByRole("button", { name: /Send command/ }).click();
  await expect(page.locator(".messages")).toContainText("Summarise today's company operations.");
  await expect(page.locator(".messages")).toContainText("secure company workspace is not connected");
});

test("workspace sign-in form gives a truthful configuration error when Supabase is absent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Talk to AI Manager/ }).click();
  await page.getByLabel("Company email").fill("admin@example.com");
  await page.getByLabel("Password").fill("not-a-real-password");
  await page.getByLabel("Organisation UUID").fill("00000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Connect workspace" }).click();
  await expect(page.locator(".auth-text")).toContainText("Supabase browser authentication is not configured");
});

test("overview intelligence link opens the AI Manager", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Open AI General Manager/ }).click();
  await expect(page.locator(".crumb")).toContainText("AI General Manager");
  await expect(page.getByRole("heading", { name: "Talk to your AI General Manager" })).toBeVisible();
});

test("module discussion action returns to the AI Manager", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: /Projects/ }).click();
  await page.getByRole("button", { name: /Discuss this module with AI Manager/ }).click();
  await expect(page.locator(".crumb")).toContainText("AI General Manager");
});
